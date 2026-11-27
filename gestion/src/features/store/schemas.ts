import { z } from "zod";
import { MAX_CART_LINES, MAX_QTY_PER_LINE } from "./availability";
import { normalizeBoPhone } from "./phone";

const text = (min: number, max: number, message: string) =>
  z.string({ error: message }).trim().min(min, message).max(max, message);

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : undefined));

export const cartLineSchema = z.object({
  variantId: z.uuid({ error: "Producto no válido" }),
  qty: z.number().int().min(1, "Mínimo 1 unidad").max(MAX_QTY_PER_LINE, `Máximo ${MAX_QTY_PER_LINE} unidades por producto`),
});

export const cartSchema = z
  .array(cartLineSchema)
  .min(1, "El carrito está vacío")
  .max(MAX_CART_LINES, `Máximo ${MAX_CART_LINES} productos distintos`)
  .refine((lines) => new Set(lines.map((l) => l.variantId)).size === lines.length, "Producto repetido en el carrito");

export type CartLineInput = z.infer<typeof cartLineSchema>;

/** Lenient parse of the cart sent by the browser: anything invalid yields an empty list (never throws). */
export function parseCartLines(raw: unknown): CartLineInput[] {
  const parsed = cartSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

const IDEMPOTENCY = /^[A-Za-z0-9_-]{22,64}$/;

export const checkoutSchema = z
  .object({
    idempotencyKey: z.string().regex(IDEMPOTENCY, "Solicitud no válida"),
    name: text(2, 80, "Escriba su nombre completo"),
    phone: z
      .string({ error: "Escriba su celular" })
      .transform((value, ctx) => {
        const national = normalizeBoPhone(value);
        if (!national) {
          ctx.addIssue({ code: "custom", message: "Escriba un celular de Bolivia de 8 dígitos (empieza con 6 o 7)" });
          return z.NEVER;
        }
        return national;
      }),
    email: z
      .string()
      .trim()
      .max(120, "Correo demasiado largo")
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || z.email().safeParse(v).success, "Escriba un correo válido o déjelo vacío"),
    fulfillment: z.enum(["delivery", "pickup"], { error: "Elija cómo recibir su pedido" }),
    zoneId: z.uuid().optional(),
    address: optionalText(200, "Dirección demasiado larga"),
    reference: optionalText(200, "Referencia demasiado larga"),
    pickupId: z.uuid().optional(),
    paymentMethod: z.enum(["qr", "contra_entrega"], { error: "Elija cómo pagar" }),
    wantsInvoice: z.boolean(),
    invoiceNit: optionalText(20, "NIT/CI demasiado largo"),
    invoiceName: optionalText(120, "Razón social demasiado larga"),
    notes: optionalText(300, "La nota admite 300 caracteres"),
    items: cartSchema,
  })
  .superRefine((value, ctx) => {
    if (value.fulfillment === "delivery") {
      if (!value.zoneId) ctx.addIssue({ code: "custom", path: ["zoneId"], message: "Elija la zona de entrega" });
      if (!value.address || value.address.length < 5) {
        ctx.addIssue({ code: "custom", path: ["address"], message: "Escriba la dirección de entrega" });
      }
    } else if (!value.pickupId) {
      ctx.addIssue({ code: "custom", path: ["pickupId"], message: "Elija dónde recoger" });
    }
    if (value.wantsInvoice) {
      if (!value.invoiceNit || !/^[0-9A-Za-z.-]{3,20}$/.test(value.invoiceNit)) {
        ctx.addIssue({ code: "custom", path: ["invoiceNit"], message: "Escriba su NIT o CI" });
      }
      if (!value.invoiceName || value.invoiceName.length < 2) {
        ctx.addIssue({ code: "custom", path: ["invoiceName"], message: "Escriba la razón social" });
      }
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const proofSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Enlace no válido"),
  reference: optionalText(60, "El número de transacción admite 60 caracteres"),
});
