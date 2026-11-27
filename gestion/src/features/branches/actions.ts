"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { firstErrors, formToValues, type FormState } from "@/lib/form";
import { assignSeller, createBranch, setBranchActive, updateBranch } from "./commands";
import { assignSellerSchema, branchSchema, setBranchActiveSchema, updateBranchSchema } from "./schemas";

const DUPLICATE_NAME = "Ya existe una sucursal con ese nombre.";

function messageFor(error: unknown): string {
  return (error as { code?: string }).code === "23505" ? DUPLICATE_NAME : friendlyDbMessage(error);
}

function refresh(): void {
  // Branch lists feed every filter and selector of the app.
  revalidatePath("/", "layout");
}

export async function createBranchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = branchSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  try {
    await createBranch(toSession(actor), parsed.data, values.active === "on");
  } catch (error) {
    return { ok: false, message: messageFor(error), values };
  }
  refresh();
  return { ok: true, message: `Sucursal “${parsed.data.name}” creada.` };
}

export async function updateBranchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = updateBranchSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  const { branchId, ...input } = parsed.data;
  try {
    const found = await updateBranch(toSession(actor), branchId, input);
    if (!found) return { ok: false, message: "La sucursal ya no existe.", values };
  } catch (error) {
    return { ok: false, message: messageFor(error), values };
  }
  refresh();
  return { ok: true, message: "Sucursal actualizada.", values };
}

/** Activate / deactivate. The database refuses to close a branch that still has stock, cash or sellers. */
export async function setBranchActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const parsed = setBranchActiveSchema.safeParse(formToValues(formData));
  if (!parsed.success) return { ok: false, message: "Solicitud no válida." };
  try {
    const found = await setBranchActive(toSession(actor), parsed.data.branchId, parsed.data.active);
    if (!found) return { ok: false, message: "La sucursal ya no existe." };
  } catch (error) {
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: parsed.data.active ? "Sucursal activada." : "Sucursal desactivada." };
}

export async function assignSellerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin");
  const values = formToValues(formData);
  const parsed = assignSellerSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  try {
    const found = await assignSeller(toSession(actor), parsed.data.userId, parsed.data.branchId);
    if (!found) return { ok: false, message: "El vendedor ya no existe.", values };
  } catch (error) {
    return { ok: false, message: messageFor(error), values };
  }
  refresh();
  revalidatePath("/usuarios");
  return { ok: true, message: "Vendedor reasignado. Si estaba conectado, deberá ingresar de nuevo.", values };
}
