"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Field } from "@/components/ui/Field";
import { Toast } from "@/components/ui/Toast";
import { resetUserPasswordAction, suggestPassphraseAction, type PasswordFormState } from "@/features/account/actions";

const initialState: PasswordFormState = { ok: false };

export function ResetPasswordForm({ userId, username }: { userId: string; username: string }) {
  const [state, action, pending] = useActionState(resetUserPasswordAction, initialState);
  const [value, setValue] = useState("");
  const [suggesting, startSuggest] = useTransition();
  const [copied, setCopied] = useState(false);
  const errors = state.fieldErrors ?? {};

  if (state.ok && state.temporaryPassword) {
    return (
      <div className="stack">
        <div className="reset-result">
          <p className="eyebrow">Contraseña temporal de {state.targetUsername ?? username}</p>
          <output className="passphrase" aria-label="Contraseña temporal">{state.temporaryPassword}</output>
          <p className="field__hint">
            Se muestra <strong>una sola vez</strong>: anótela o cópiela ahora y entréguela en persona. El sistema solo guarda su huella, nunca el texto.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(state.temporaryPassword ?? "").then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? "Copiada" : "Copiar"}
            </button>
            <Link className="btn btn--primary" href="/usuarios">Volver a Usuarios</Link>
          </div>
        </div>
        <Toast message={state.message} signal={state} />
      </div>
    );
  }

  return (
    <form action={action} className="stack" noValidate>
      <input type="hidden" name="userId" value={userId} />
      {state.message ? (
        <p className="notice notice--error" role="alert">
          {state.message}
        </p>
      ) : null}
      <Field
        label="Contraseña temporal"
        name="newPassword"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={errors.newPassword}
        hint="Mínimo 12 caracteres. Escríbala o pida una sugerencia de palabras reales."
        required
      />
      <div className="form-actions">
        <button
          type="button"
          className="btn btn--small"
          disabled={suggesting}
          onClick={() => startSuggest(async () => setValue(await suggestPassphraseAction()))}
        >
          {suggesting ? "Pensando…" : "Sugerir una frase"}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" name="mustChange" defaultChecked />
        Pedir que la cambie al ingresar
      </label>
      <div className="form-actions">
        <button className="btn btn--primary" type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Restablecer contraseña"}
        </button>
        <Link className="btn btn--quiet" href="/usuarios">Cancelar</Link>
      </div>
    </form>
  );
}
