"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Toast } from "@/components/ui/Toast";
import { changeOwnPasswordAction, type PasswordFormState } from "./actions";

const initialState: PasswordFormState = { ok: false };

export function ChangePasswordForm({ username }: { username: string }) {
  const [state, action, pending] = useActionState(changeOwnPasswordAction, initialState);
  const [visible, setVisible] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  const errors = state.fieldErrors ?? {};
  const type = visible ? "text" : "password";
  return (
    <>
      <form ref={formRef} action={action} className="stack" noValidate>
        {/* lets password managers pair the new password with the right account */}
        <input className="sr-only" type="text" name="username" value={username} autoComplete="username" readOnly tabIndex={-1} aria-hidden="true" />
        {!state.ok && state.message ? (
          <p className="notice notice--error" role="alert">
            {state.message}
          </p>
        ) : null}
        <Field label="Contraseña actual" name="currentPassword" type={type} autoComplete="current-password" error={errors.currentPassword} required />
        <Field
          label="Contraseña nueva"
          name="newPassword"
          type={type}
          autoComplete="new-password"
          error={errors.newPassword}
          hint="Mínimo 12 caracteres. Una frase de palabras separadas por guiones es fácil de recordar y difícil de adivinar."
          required
        />
        <Field label="Repita la contraseña nueva" name="confirmPassword" type={type} autoComplete="new-password" error={errors.confirmPassword} required />
        <label className="check">
          <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
          Mostrar las contraseñas
        </label>
        <div className="form-actions">
          <button className="btn btn--primary" type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </div>
      </form>
      <Toast message={state.ok ? state.message : undefined} signal={state} />
    </>
  );
}
