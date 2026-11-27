"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { formToValues, type FormState } from "@/lib/form";
import { closeCashSession, openCashSession, CashError } from "./commands";
import { formatBs } from "@/lib/money";

const UUID = /^[0-9a-f-]{36}$/i;

function describe(error: unknown): string {
  return error instanceof CashError ? error.message : friendlyDbMessage(error);
}

/** Sellers open the cash of their own branch; the superadmin names the branch. */
export async function openCashAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin", "seller");
  const values = formToValues(formData);
  const branchId = actor.role === "seller" ? actor.branchId : values.branchId;
  if (!branchId || !UUID.test(branchId)) return { ok: false, message: "Seleccione la sucursal.", values };
  try {
    await openCashSession(toSession(actor), branchId, values.opening ?? "");
  } catch (error) {
    return { ok: false, message: describe(error), values };
  }
  revalidatePath("/ventas", "layout");
  return { ok: true, message: "Caja abierta. Ya puede vender." };
}

export async function closeCashAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin", "seller");
  const values = formToValues(formData);
  if (!values.sessionId || !UUID.test(values.sessionId)) return { ok: false, message: "Caja no válida.", values };
  try {
    // No revalidation here on purpose: the form stays on screen to show expected vs counted,
    // and its "Continuar" button refreshes the page.
    const closed = await closeCashSession(toSession(actor), values.sessionId, values.counted ?? "");
    const diff = closed.difference;
    const note =
      diff === "0.00" ? "La caja cuadra." : diff.startsWith("-") ? `Faltan ${formatBs(diff.replace("-", ""))}.` : `Sobran ${formatBs(diff)}.`;
    return { ok: true, message: `Caja cerrada. Esperado ${formatBs(closed.expected)}, contado ${formatBs(closed.counted)}. ${note}` };
  } catch (error) {
    return { ok: false, message: describe(error), values };
  }
}
