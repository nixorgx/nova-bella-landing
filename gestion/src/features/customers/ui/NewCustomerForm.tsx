"use client";

import { useActionState, useEffect, useRef } from "react";
import { Field } from "@/components/ui/Field";
import { createCustomerAction, type CustomerFormState } from "../actions";
import type { CustomerOption } from "../queries";

const IDLE: CustomerFormState = { ok: false };

/** Quick-create (name, phone, CI/NIT). Reports the created customer so the POS can select it. */
export function NewCustomerForm({ onCreated, compact = false }: { onCreated?: (customer: CustomerOption) => void; compact?: boolean }) {
  const [state, action, pending] = useActionState(createCustomerAction, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const callback = useRef(onCreated);

  useEffect(() => {
    callback.current = onCreated;
  });
  useEffect(() => {
    if (!state.ok || !state.customer) return;
    formRef.current?.reset();
    callback.current?.(state.customer);
  }, [state]);

  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  return (
    <form ref={formRef} action={action} className="stack" noValidate>
      {state.message ? (
        <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>
      ) : null}
      <Field label="Nombre" name="name" autoComplete="off" defaultValue={values.name} error={errors.name} required autoFocus={!compact} />
      <Field label="Teléfono" name="phone" type="tel" inputMode="tel" autoComplete="off" defaultValue={values.phone} error={errors.phone} />
      <Field label="CI / NIT" name="ciNit" autoComplete="off" defaultValue={values.ciNit} error={errors.ciNit} />
      <div className="form-actions">
        <button className="btn btn--primary" type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar cliente"}</button>
      </div>
    </form>
  );
}
