import { formatBs } from "@/lib/money";

/** wa.me link with a prefilled message. `digits` is the number with country code (e.g. 59171234567). */
export function waLink(digits: string | null | undefined, message: string): string | null {
  if (!digits || !/^\d{8,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message.slice(0, 1500))}`;
}

/** The setting is stored with country code; typing the 8 national digits is accepted and completed. */
export function toWhatsappDigits(raw: string): string | null {
  const digits = raw.replace(/[\s().+-]/g, "");
  if (/^[67]\d{7}$/.test(digits)) return `591${digits}`;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function productInquiryMessage(input: { model: string; color?: string; size?: string; price: string; url?: string }): string {
  const detail = [input.color, input.size ? `talla ${input.size}` : null].filter(Boolean).join(", ");
  return [
    `Hola NovaBella, quisiera consultar por ${input.model}${detail ? ` (${detail})` : ""} - ${formatBs(input.price)}.`,
    input.url ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface OrderSummaryForMessage {
  readonly code: string;
  readonly total: string;
  readonly items: readonly { model: string; color: string; size: string; qty: number }[];
}

/** Summary the buyer sends to the shop from the confirmation page (code only: never the private link). */
export function orderSummaryMessage(order: OrderSummaryForMessage): string {
  const lines = order.items.map((i) => `- ${i.qty} x ${i.model} (${i.color}, talla ${i.size})`);
  return [`Hola NovaBella, hice el pedido ${order.code} por ${formatBs(order.total)}.`, ...lines, "Gracias."].join("\n");
}

export function paymentProofMessage(order: { code: string; total: string }): string {
  return `Hola NovaBella, pagué el pedido ${order.code} por ${formatBs(order.total)}. Les envío el comprobante.`;
}
