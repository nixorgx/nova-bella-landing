"use client";

import { useActionState, useEffect, useRef } from "react";
import { Field } from "@/components/ui/Field";
import { createSellerAction, type UserFormState } from "./actions";
import type { BranchOption } from "./queries";

const initialState: UserFormState = { ok: false };

export function CreateSellerForm({ branches }: { branches: readonly BranchOption[] }) {
  const [state, action, pending] = useActionState(createSellerAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  return (
    <form ref={formRef} action={action} className="stack" noValidate>
      {state.message ? (
        <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      ) : null}
      <Field label="Usuario" name="username" defaultValue={values.username} autoComplete="off" autoCapitalize="none" spellCheck={false} error={errors.username} hint="Minúsculas, sin espacios." required />
      <Field label="Nombre completo" name="fullName" defaultValue={values.fullName} autoComplete="off" error={errors.fullName} required />
      <div className="field">
        <label className="field__label" htmlFor="field-branchId">Sucursal</label>
        <select key={values.branchId ?? "none"} id="field-branchId" name="branchId" className="field__control" defaultValue={values.branchId ?? ""} required aria-invalid={errors.branchId ? true : undefined}>
          <option value="" disabled>Seleccione…</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.name}</option>
          ))}
        </select>
        {errors.branchId ? <p className="field__error" role="alert">{errors.branchId}</p> : null}
      </div>
      <Field label="Contraseña inicial" name="password" type="password" autoComplete="new-password" error={errors.password} hint="Mínimo 12 caracteres." required />
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? "Creando…" : "Crear vendedor"}
      </button>
    </form>
  );
}
