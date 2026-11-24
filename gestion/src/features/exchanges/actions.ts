"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { createExchange } from "./create-exchange";
import { previewExchange, type ExchangePreview } from "./preview";
import { exchangeInputSchema, exchangePreviewSchema } from "./schemas";

export type PreviewResult =
  | { readonly ok: true; readonly preview: ExchangePreview }
  | { readonly ok: false; readonly message: string };

export type ConfirmExchangeResult =
  | { readonly ok: true; readonly groupId: string; readonly saleId: string }
  | { readonly ok: false; readonly message: string };

/** Prices the exchange on the server (nothing is written). */
export async function previewExchangeAction(raw: unknown): Promise<PreviewResult> {
  const actor = await requireRole("superadmin", "seller");
  const parsed = exchangePreviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "El cambio no es válido." };
  try {
    return { ok: true, preview: await previewExchange(toSession(actor), parsed.data) };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
}

export async function confirmExchangeAction(raw: unknown): Promise<ConfirmExchangeResult> {
  const actor = await requireRole("superadmin", "seller");
  const parsed = exchangeInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "El cambio no es válido." };
  try {
    const session = toSession(actor);
    const preview = await previewExchange(session, parsed.data);
    if (!preview.canConfirm) {
      const blocked = preview.lines.find((line) => line.issue)?.issue;
      return { ok: false, message: blocked ?? "No se pudo calcular la diferencia del cambio." };
    }
    if (preview.needsMethod && !parsed.data.paymentMethod) {
      const verb = preview.direction === "devolver" ? "devuelve" : "cobra";
      return { ok: false, message: `Indique cómo se ${verb} la diferencia (efectivo, QR, transferencia o tarjeta).` };
    }
    const created = await createExchange(session, parsed.data);
    revalidatePath("/ventas", "layout");
    revalidatePath("/stock");
    return { ok: true, groupId: created.groupId, saleId: parsed.data.saleId };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
}
