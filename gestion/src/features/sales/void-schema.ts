import { z } from "zod";

export const MIN_VOID_REASON = 5;
export const MAX_VOID_REASON = 200;

export const voidSaleSchema = z.object({
  saleId: z.uuid("Venta no válida."),
  reason: z
    .string({ error: "Escriba el motivo de la anulación." })
    .trim()
    .min(MIN_VOID_REASON, `Escriba el motivo de la anulación (mínimo ${MIN_VOID_REASON} caracteres).`)
    .max(MAX_VOID_REASON, `El motivo admite hasta ${MAX_VOID_REASON} caracteres.`),
});

export type VoidSaleInput = z.infer<typeof voidSaleSchema>;
