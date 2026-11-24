"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { firstErrors, formToValues, type FormState } from "@/lib/form";
import { formatBs } from "@/lib/money";
import { savePricingSettings, pricingSettingsSchema } from "@/features/settings/pricing-settings";
import { createBatch } from "./batches";
import { parseDraft } from "./form-math";
import { applyModelPrice } from "./model-costs";
import { createRate } from "./rates";
import { batchPayloadSchema, rateSchema } from "./schemas";

const UUID = /^[0-9a-f-]{36}$/i;

export type CreateBatchResult =
  | { readonly ok: true; readonly batchId: string }
  | { readonly ok: false; readonly message: string };

/** Confirms a purchase batch. Superadmin only; the RPC is transactional and re-validates everything. */
export async function createBatchAction(raw: unknown): Promise<CreateBatchResult> {
  const actor = await requireRole("superadmin");
  const parsed = batchPayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "El lote no es válido." };
  const { branchId, batchDate, supplier, notes, ...draftInput } = parsed.data;

  const draft = parseDraft(draftInput);
  if (!draft.ok) {
    const first = Object.values(draft.errors).find(Boolean);
    return { ok: false, message: first ?? "Revise los datos del lote." };
  }
  const variantIds = draft.value.items.map((item) => item.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    return { ok: false, message: "Un producto aparece repetido en el lote." };
  }
  try {
    const batchId = await createBatch(toSession(actor), { branchId, batchDate, supplier, notes }, draft.value);
    revalidatePath("/compras", "layout");
    revalidatePath("/stock");
    return { ok: true, batchId };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
}

export async function createRateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = rateSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  try {
    await createRate(toSession(actor), parsed.data);
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error), values };
  }
  revalidatePath("/compras", "layout");
  return { ok: true, message: "Tipo de cambio registrado." };
}

export async function savePricingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = pricingSettingsSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  try {
    await savePricingSettings(toSession(actor), parsed.data);
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error), values };
  }
  revalidatePath("/compras", "layout");
  return { ok: true, message: "Políticas de precio guardadas." };
}

/**
 * Applies a suggested price. Never automatic: the form posts `confirm=yes` only after the
 * superadmin reads the old/new price in the confirmation dialog.
 */
export async function applyPriceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  if (values.confirm !== "yes") return { ok: false, message: "Confirme el cambio de precio para aplicarlo." };
  if (!values.modelId || !UUID.test(values.modelId)) return { ok: false, message: "Modelo no válido." };
  try {
    const price = await applyModelPrice(toSession(actor), values.modelId, values.price ?? "");
    revalidatePath("/compras", "layout");
    revalidatePath("/catalogo", "layout");
    return { ok: true, message: `Precio actualizado a ${formatBs(price)}.` };
  } catch (error) {
    return { ok: false, message: error instanceof RangeError ? error.message : friendlyDbMessage(error) };
  }
}
