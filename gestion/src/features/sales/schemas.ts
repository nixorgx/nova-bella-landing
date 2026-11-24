import { z } from "zod";
import { dec, parseMoney } from "@/lib/money";
import { PAYMENT_METHODS } from "./payments";

const MAX_LINES = 60;
const MAX_QTY = 999;
const MAX_AMOUNT = 9_999_999.99;

const moneyString = (message: string) =>
  z.string({ error: message }).transform((value, ctx) => {
    const money = parseMoney(value);
    if (money === null || dec(money).lte(0) || dec(money).gt(MAX_AMOUNT)) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return money;
  });

export const saleInputSchema = z
  .object({
    branchId: z.uuid("Seleccione la sucursal.").nullish(),
    customerId: z.uuid("Cliente no válido.").nullish(),
    docType: z.enum(["factura", "nota_venta"], { error: "Elija Factura o Nota de venta." }),
    items: z
      .array(
        z.object({
          variantId: z.uuid("Producto no válido."),
          qty: z.number().int("La cantidad debe ser entera.").min(1, "La cantidad mínima es 1.").max(MAX_QTY),
          finalPrice: moneyString("Cada producto necesita un precio mayor a cero (ej. 150,50)."),
        }),
      )
      .min(1, "Agregue al menos un producto.")
      .max(MAX_LINES, `Una venta admite hasta ${MAX_LINES} productos distintos.`),
    payments: z
      .array(
        z.object({
          method: z.enum(PAYMENT_METHODS, { error: "Método de pago no válido." }),
          amount: moneyString("Cada pago necesita un monto mayor a cero."),
        }),
      )
      .min(1, "Registre al menos un pago.")
      .max(8, "Demasiadas filas de pago."),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const item of value.items) {
      if (seen.has(item.variantId)) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Un producto aparece repetido en la venta." });
        return;
      }
      seen.add(item.variantId);
    }
  });

export type SaleInput = z.infer<typeof saleInputSchema>;
