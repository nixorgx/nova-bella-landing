"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui/Field";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <form action={action} noValidate>
      {state.error ? (
        <p className="notice notice--error" role="alert">
          {state.error}
        </p>
      ) : null}
      <Field label="Usuario" name="username" defaultValue={state.username} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
      <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
