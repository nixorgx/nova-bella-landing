import { z } from "zod";
import { MAX_TRANSFER_QTY, parseQty } from "./draft";

const MAX_LINES = 200;

const lineSchema = z.object({
  variantId: z.uuid("Producto no válido."),
  qtyInput: z.string().max(10).transform((value, ctx) => {
    const qty = parseQty(value);
    if (qty === null) {
      ctx.addIssue({ code: "custom", message: `La cantidad debe ser un número entero entre 1 y ${MAX_TRANSFER_QTY}.` });
      return z.NEVER;
    }
    return qty;
  }),
});

/** What the browser sends to confirm a transfer; re-validated here and again by the database. */
export const transferPayloadSchema = z
  .object({
    fromBranchId: z.uuid("Seleccione la sucursal de origen."),
    toBranchId: z.uuid("Seleccione la sucursal de destino."),
    note: z
      .string()
      .trim()
      .max(300, "La nota no puede pasar de 300 caracteres.")
      .optional()
      .transform((value) => (value ? value : null)),
    items: z.array(lineSchema).min(1, "Agregue al menos un producto.").max(MAX_LINES, `Una transferencia admite hasta ${MAX_LINES} productos.`),
  })
  .refine((value) => value.fromBranchId !== value.toBranchId, {
    path: ["toBranchId"],
    message: "El origen y el destino deben ser distintos.",
  })
  .refine((value) => new Set(value.items.map((item) => item.variantId)).size === value.items.length, {
    path: ["items"],
    message: "Un producto aparece repetido en la transferencia.",
  });

export type TransferPayload = z.infer<typeof transferPayloadSchema>;
