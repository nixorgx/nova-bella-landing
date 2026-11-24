"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { friendlyDbMessage } from "@/lib/db-errors";
import { firstErrors, formToValues, type FormState } from "@/lib/form";
import { createCustomer, updateCustomer, type CustomerOption } from "./queries";
import { customerSchema } from "./schemas";

export interface CustomerFormState extends FormState {
  readonly customer?: CustomerOption;
}

function parse(formData: FormData) {
  const values = formToValues(formData);
  const parsed = customerSchema.safeParse({
    name: values.name,
    phone: values.phone,
    ciNit: values.ciNit,
    notes: values.notes,
  });
  return { values, parsed };
}

export async function createCustomerAction(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const actor = await requireRole("superadmin", "seller");
  const { values, parsed } = parse(formData);
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  try {
    const customer = await createCustomer(toSession(actor), parsed.data);
    revalidatePath("/clientes");
    return { ok: true, message: `Cliente “${customer.name}” guardado.`, customer };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error), values };
  }
}

export async function updateCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireRole("superadmin", "seller");
  const { values, parsed } = parse(formData);
  const id = values.id;
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values };
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "Cliente no válido.", values };
  try {
    const updated = await updateCustomer(toSession(actor), id, parsed.data);
    if (!updated) return { ok: false, message: "No se encontró el cliente.", values };
    revalidatePath("/clientes", "layout");
    return { ok: true, message: "Cliente actualizado." };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error), values };
  }
}
