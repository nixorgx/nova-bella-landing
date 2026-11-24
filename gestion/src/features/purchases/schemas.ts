import { z } from "zod";
import { parseRate } from "@/lib/number-input";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** A calendar date (YYYY-MM-DD) that is real and not more than a day in the future. */
export const dateField = z
  .string({ error: "Ingrese una fecha válida." })
  .refine(isRealDate, "Ingrese una fecha válida.")
  .refine((value) => new Date(`${value}T00:00:00Z`).getTime() <= Date.now() + 2 * DAY_MS, "La fecha no puede ser futura.");

const rateField = (label: string) =>
  z.string({ error: `Ingrese ${label}.` }).transform((value, ctx) => {
    const rate = parseRate(value);
    if (rate === null) {
      ctx.addIssue({ code: "custom", message: `Ingrese ${label} mayor a cero (ej. 6,96).` });
      return z.NEVER;
    }
    return rate;
  });

export const rateSchema = z.object({
  rateDate: dateField,
  officialRate: rateField("el tipo de cambio oficial"),
  parallelRate: rateField("el tipo de cambio paralelo"),
});

export const batchMetaSchema = z.object({
  branchId: z.uuid("Seleccione la sucursal."),
  batchDate: dateField,
  supplier: z
    .string()
    .trim()
    .max(80, "El proveedor no puede pasar de 80 caracteres.")
    .optional()
    .transform((value) => (value ? value : null)),
  notes: z
    .string()
    .trim()
    .max(300, "Las notas no pueden pasar de 300 caracteres.")
    .optional()
    .transform((value) => (value ? value : null)),
});

/** What the browser sends: the typed text of each field, re-parsed by the server. */
export const batchPayloadSchema = batchMetaSchema.extend({
  rate70Input: z.string().max(20),
  rate30Input: z.string().max(20),
  splitInput: z.string().max(10),
  freightInput: z.string().max(20),
  items: z
    .array(
      z.object({
        variantId: z.uuid("Producto no válido."),
        qtyInput: z.string().max(10),
        costInput: z.string().max(12),
      }),
    )
    .max(500),
});

export type BatchPayload = z.infer<typeof batchPayloadSchema>;
