"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { publicQuery } from "@/lib/db";
import { friendlyDbMessage } from "@/lib/db-errors";
import { getOrderTokenSecret } from "@/lib/env";
import { firstErrors, formToValues, type FormState } from "@/lib/form";
import { ImageRejected, processProof, readUpload } from "./images";
import { deriveOrderToken, hashOrderToken, isWellFormedToken } from "./order-token";
import { getCartLines, getOrderView, type CartLineDetail } from "./public-data";
import { checkoutSchema, parseCartLines, proofSchema } from "./schemas";
import { LIMITS, reserve, reserveAll, reserveIp, requestIp, waitMessage } from "./throttle";

const GENERIC = "No pudimos procesar su solicitud. Intente nuevamente o escríbanos por WhatsApp.";

export interface CartCheckResult {
  readonly ok: boolean;
  readonly lines: readonly CartLineDetail[];
  readonly message?: string;
}

/** Live price/stock of the lines the browser holds (the browser never decides prices). */
export async function validateCartAction(rawLines: unknown): Promise<CartCheckResult> {
  const lines = parseCartLines(rawLines);
  if (lines.length === 0) return { ok: true, lines: [] };
  const gate = await reserveIp(LIMITS.cartIp, await requestIp());
  if (!gate.allowed) return { ok: false, lines: [], message: waitMessage(gate) };
  try {
    return { ok: true, lines: await getCartLines(lines) };
  } catch {
    return { ok: false, lines: [], message: "No pudimos actualizar su carrito. Intente nuevamente." };
  }
}

function checkoutValues(formData: FormData): Record<string, unknown> {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };
  let items: unknown = [];
  try {
    items = JSON.parse(text("items") ?? "[]");
  } catch {
    items = [];
  }
  return {
    idempotencyKey: text("idempotencyKey"),
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    fulfillment: text("fulfillment"),
    zoneId: text("zoneId") || undefined,
    address: text("address"),
    reference: text("reference"),
    pickupId: text("pickupId") || undefined,
    paymentMethod: text("paymentMethod"),
    wantsInvoice: text("wantsInvoice") === "on",
    invoiceNit: text("invoiceNit"),
    invoiceName: text("invoiceName"),
    notes: text("notes"),
    items,
  };
}

/** Creates the order. Same idempotency key = same order (double click / retry), never a duplicate. */
export async function createOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formToValues(formData);
  // Honeypot: a hidden field real people never fill.
  if ((formData.get("website") ?? "") !== "") return { ok: false, message: GENERIC, values };

  const parsed = checkoutSchema.safeParse(checkoutValues(formData));
  if (!parsed.success) {
    return { ok: false, message: "Revise los datos marcados.", fieldErrors: firstErrors(parsed.error.issues), values };
  }
  const input = parsed.data;

  const ipGate = await reserveIp(LIMITS.checkoutIp, await requestIp());
  const gate = ipGate.allowed
    ? await reserveAll([
        { limit: LIMITS.checkoutPhone, subject: input.phone },
        { limit: LIMITS.checkoutAll, subject: "all" },
      ])
    : ipGate;
  if (!gate.allowed) return { ok: false, message: waitMessage(gate), values };

  const token = deriveOrderToken(input.idempotencyKey, getOrderTokenSecret());
  const payload = {
    // Only the hash is stored: the plain key (with the server secret) is what derives the buyer token, so a database
    // reader (staff, backups) must not see it.
    idempotency_key: createHash("sha256").update(input.idempotencyKey).digest("hex"),
    name: input.name,
    phone: input.phone,
    email: input.email ?? "",
    payment_method: input.paymentMethod,
    fulfillment: input.fulfillment,
    zone_id: input.zoneId ?? "",
    address: input.address ?? "",
    reference: input.reference ?? "",
    pickup_id: input.pickupId ?? "",
    wants_invoice: String(input.wantsInvoice),
    invoice_nit: input.invoiceNit ?? "",
    invoice_name: input.invoiceName ?? "",
    notes: input.notes ?? "",
    items: input.items.map((line) => ({ variant_id: line.variantId, qty: line.qty })),
  };
  try {
    await publicQuery("select * from public_create_order($1::jsonb, $2)", [JSON.stringify(payload), hashOrderToken(token)]);
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error), values };
  }
  redirect(`/tienda/pedido/${token}?nuevo=1`);
}

/** Buyer sends a payment proof (photo and/or transaction number). */
export async function submitProofAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = proofSchema.safeParse({
    token: formData.get("token"),
    reference: typeof formData.get("reference") === "string" ? formData.get("reference") : undefined,
  });
  if (!parsed.success) return { ok: false, message: "Revise el comprobante.", fieldErrors: firstErrors(parsed.error.issues) };
  const { token, reference } = parsed.data;

  const tokenHash = hashOrderToken(token);
  const ipGate = await reserveIp(LIMITS.proofIp, await requestIp());
  const gate = ipGate.allowed ? await reserve(LIMITS.proofToken, tokenHash.toString("hex").slice(0, 32)) : ipGate;
  if (!gate.allowed) return { ok: false, message: waitMessage(gate) };
  // Cheap existence check BEFORE decoding any image: strangers cannot make the server run sharp.
  if (!(await getOrderView(tokenHash).catch(() => null))) return { ok: false, message: "Pedido no encontrado." };

  const file = formData.get("proof");
  let bytes: Buffer | null = null;
  let etag: string | null = null;
  if (file instanceof File && file.size > 0) {
    try {
      const processed = await processProof(await readUpload(file));
      bytes = processed.image.bytes;
      etag = processed.etag;
    } catch (error) {
      return { ok: false, message: error instanceof ImageRejected ? error.message : GENERIC };
    }
  }
  try {
    await publicQuery("select public_order_attach_proof($1, $2, $3, $4)", [tokenHash, bytes, etag, reference ?? null]);
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
  return { ok: true, message: "¡Recibimos su comprobante! Revisaremos su pago y le avisaremos." };
}

export async function cancelOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  if (!isWellFormedToken(token)) return { ok: false, message: GENERIC };
  const ipGate = await reserveIp(LIMITS.cancelIp, await requestIp());
  const gate = ipGate.allowed ? await reserve(LIMITS.cancelToken, hashOrderToken(token).toString("hex").slice(0, 32)) : ipGate;
  if (!gate.allowed) return { ok: false, message: waitMessage(gate) };
  try {
    await publicQuery("select public_order_cancel($1)", [hashOrderToken(token)]);
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
  return { ok: true, message: "Pedido cancelado." };
}
