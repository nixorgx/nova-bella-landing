"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { voidSaleSchema } from "./void-schema";
import { voidSale } from "./void-sale";

export type VoidSaleResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Superadmin only. The reason is mandatory and stored with the sale. */
export async function voidSaleAction(raw: unknown): Promise<VoidSaleResult> {
  const actor = await requireRole("superadmin");
  const parsed = voidSaleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "La anulación no es válida." };
  try {
    await voidSale(toSession(actor), parsed.data);
    revalidatePath("/ventas", "layout");
    revalidatePath("/stock");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
}
