import { z } from "zod";
import { dec, parseMoney } from "@/lib/money";
import { PAYMENT_METHODS } from "@/features/sales/payments";
import { EXCHANGE_REASONS } from "./reasons";

const MAX_LINES = 20;
const MAX_QTY = 999;

const overrideSchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value.trim() === "") return undefined;
    const money = parseMoney(value);
    if (money === null || dec(money).abs().gt(9_999_999.99)) {
      ctx.addIssue({ code: "custom", message: "La diferencia manual debe ser un monto en Bs (ej. -15,50)." });
      return z.NEVER;
    }
    return money;
  });

export const exchangeLineSchema = z.object({
  returnedVariantId: z.uuid("Producto devuelto no válido."),
  newVariantId: z.uuid("Elija el producto nuevo de cada línea."),
  qty: z.number({ error: "Cantidad no válida." }).int("La cantidad debe ser entera.").min(1, "La cantidad mínima es 1.").max(MAX_QTY),
  /** Superadmin only; ignored (and rejected by the database) for sellers. */
  priceDiffOverride: overrideSchema,
});

export const exchangePreviewSchema = z.object({
  saleId: z.uuid("Venta no válida."),
  lines: z.array(exchangeLineSchema).min(1, "Elija al menos un producto a cambiar.").max(MAX_LINES),
});

export const exchangeInputSchema = exchangePreviewSchema.extend({
  paymentMethod: z.enum(PAYMENT_METHODS, { error: "Método de pago no válido." }).nullish(),
  reason: z.enum(EXCHANGE_REASONS, { error: "Elija el motivo del cambio." }),
  note: z.string().max(200, "La nota admite hasta 200 caracteres.").optional(),
});

export type ExchangeLineInput = z.infer<typeof exchangeLineSchema>;
export type ExchangePreviewInput = z.infer<typeof exchangePreviewSchema>;
export type ExchangeInput = z.infer<typeof exchangeInputSchema>;
