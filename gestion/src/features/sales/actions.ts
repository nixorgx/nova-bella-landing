"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { createSale, SaleError } from "./create-sale";
import { saleInputSchema } from "./schemas";

export type ConfirmSaleResult =
  | { readonly ok: true; readonly saleId: string }
  | { readonly ok: false; readonly message: string };

/** Called by the POS with a JSON-able payload; every field is re-validated here. */
export async function confirmSaleAction(raw: unknown): Promise<ConfirmSaleResult> {
  const actor = await requireRole("superadmin", "seller");
  const parsed = saleInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "La venta no es válida." };
  }
  try {
    const saleId = await createSale(toSession(actor), parsed.data);
    revalidatePath("/ventas", "layout");
    return { ok: true, saleId };
  } catch (error) {
    if (error instanceof SaleError) return { ok: false, message: error.message };
    return { ok: false, message: friendlyDbMessage(error) };
  }
}
