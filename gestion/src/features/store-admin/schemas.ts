import { z } from "zod";
import { parseMoney } from "@/lib/money";
import { toWhatsappDigits } from "@/features/store/whatsapp";

const longText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).optional().transform((v) => (v ? v : null));

export const storeSettingsSchema = z.object({
  open: z.boolean(),
  whatsapp: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const digits = toWhatsappDigits(value);
      if (!digits) {
        ctx.addIssue({ code: "custom", message: "Escriba el celular con 8 dígitos (o con código de país, ej. 59171234567)" });
        return z.NEVER;
      }
      return digits;
    }),
  branchId: z.union([z.uuid(), z.literal("")]).transform((v) => (v ? v : null)),
  bankInstructions: longText(1000),
  policyExchange: longText(1000),
  policyShipping: longText(1000),
});

const fee = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const money = parseMoney(value);
    if (money === null || Number(money) < 0 || Number(money) > 9999) {
      ctx.addIssue({ code: "custom", message: "Escriba un monto entre 0 y 9.999" });
      return z.NEVER;
    }
    return money;
  });

export const zoneSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => (v ? v : null)),
  name: z.string().trim().min(1, "Escriba el nombre de la zona").max(80, "Máximo 80 caracteres"),
  description: longText(200),
  fee,
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean(),
});

export const pickupSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional().transform((v) => (v ? v : null)),
  branchId: z.uuid({ error: "Elija la sucursal" }),
  label: z.string().trim().min(1, "Escriba el nombre del punto").max(80, "Máximo 80 caracteres"),
  address: longText(200),
  hours: longText(120),
  active: z.boolean(),
});

export const photoMetaSchema = z.object({
  modelId: z.uuid(),
  colorId: z.union([z.uuid(), z.literal("")]).transform((v) => (v ? v : null)),
  alt: z.string().trim().max(160, "Máximo 160 caracteres").optional().transform((v) => (v ? v : null)),
});

export const bulkPublishSchema = z.object({
  mode: z.enum(["publish", "unpublish", "publish_ready"]),
  ids: z.array(z.uuid()).max(300),
});
