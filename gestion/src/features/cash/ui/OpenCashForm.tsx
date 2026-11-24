"use client";

import { useActionState } from "react";
import { IDLE_FORM } from "@/lib/form";
import { openCashAction } from "../actions";

/** One-click open: the amount defaults to 0 and can be typed before pressing the button. */
export function OpenCashForm({ branchId, branchName, isAdmin }: { branchId: string; branchName: string; isAdmin: boolean }) {
  const [state, action, pending] = useActionState(openCashAction, IDLE_FORM);
  return (
    <form action={action} className="cash-banner__form" noValidate>
      {isAdmin ? <input type="hidden" name="branchId" value={branchId} /> : null}
      <div className="field">
        <label className="field__label" htmlFor="opening">Efectivo en caja al abrir (Bs)</label>
        <input id="opening" name="opening" className="field__control num" inputMode="decimal" autoComplete="off" placeholder="0,00" defaultValue={state.values?.opening} />
      </div>
      <button type="submit" className="btn btn--primary btn--big" disabled={pending}>
        {pending ? "Abriendo…" : `Abrir caja de ${branchName}`}
      </button>
      {state.message && !state.ok ? <p className="notice notice--error" role="alert">{state.message}</p> : null}
    </form>
  );
}
