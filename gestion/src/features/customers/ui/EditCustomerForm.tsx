"use client";

import { ActionForm } from "@/components/form/ActionForm";
import { FormField, FormTextarea } from "@/components/form/fields";
import { updateCustomerAction } from "../actions";
import type { CustomerDetail } from "../queries";

export function EditCustomerForm({ customer }: { customer: CustomerDetail }) {
  return (
    <ActionForm action={updateCustomerAction} submitLabel="Guardar cambios">
      <input type="hidden" name="id" value={customer.id} />
      <FormField label="Nombre" name="name" defaultValue={customer.name} autoComplete="off" required />
      <FormField label="Teléfono" name="phone" type="tel" inputMode="tel" defaultValue={customer.phone ?? ""} autoComplete="off" />
      <FormField label="CI / NIT" name="ciNit" defaultValue={customer.ciNit ?? ""} autoComplete="off" />
      <FormTextarea label="Notas" name="notes" defaultValue={customer.notes ?? ""} maxLength={200} />
    </ActionForm>
  );
}
