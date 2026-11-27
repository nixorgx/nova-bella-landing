"use client";

import { ActionForm } from "@/components/form/ActionForm";
import { FormCheckbox, FormField } from "@/components/form/fields";
import { createBranchAction, updateBranchAction } from "../actions";

interface Props {
  /** When present the form edits this branch; otherwise it creates a new one. */
  readonly branch?: { readonly id: string; readonly name: string; readonly city: string | null };
}

export function BranchForm({ branch }: Props) {
  return (
    <ActionForm
      key={branch?.id ?? "new"}
      action={branch ? updateBranchAction : createBranchAction}
      submitLabel={branch ? "Guardar cambios" : "Crear sucursal"}
      resetOnSuccess={!branch}
    >
      {branch ? <input type="hidden" name="branchId" value={branch.id} /> : null}
      <FormField label="Nombre" name="name" defaultValue={branch?.name} maxLength={60} autoComplete="off" required />
      <FormField label="Ciudad" name="city" defaultValue={branch?.city ?? ""} maxLength={60} autoComplete="off" />
      {branch ? null : <FormCheckbox label="Activa desde ya (déjela sin marcar si abrirá más adelante)" name="active" defaultChecked />}
    </ActionForm>
  );
}
