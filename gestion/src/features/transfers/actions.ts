"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { createTransfer } from "./commands";
import { transferPayloadSchema } from "./schemas";

export type CreateTransferResult =
  | { readonly ok: true; readonly transferId: string }
  | { readonly ok: false; readonly message: string };

/** Confirms a stock transfer between branches. Superadmin only; the RPC re-checks everything. */
export async function createTransferAction(raw: unknown): Promise<CreateTransferResult> {
  const actor = await requireRole("superadmin");
  const parsed = transferPayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "La transferencia no es válida." };
  try {
    const transferId = await createTransfer(toSession(actor), parsed.data);
    revalidatePath("/sucursales", "layout");
    revalidatePath("/stock");
    revalidatePath("/dashboard");
    return { ok: true, transferId };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
}
