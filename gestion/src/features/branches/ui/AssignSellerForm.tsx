"use client";

import { useActionState } from "react";
import { IDLE_FORM } from "@/lib/form";
import { assignSellerAction } from "../actions";

interface Props {
  readonly userId: string;
  readonly username: string;
  readonly currentBranchId: string | null;
  readonly branches: readonly { id: string; name: string }[];
}

export function AssignSellerForm({ userId, username, currentBranchId, branches }: Props) {
  const [state, action, pending] = useActionState(assignSellerAction, IDLE_FORM);
  const selectId = `assign-${userId}`;
  return (
    <form action={action} className="assign">
      <input type="hidden" name="userId" value={userId} />
      <label className="sr-only" htmlFor={selectId}>Sucursal de {username}</label>
      <select id={selectId} name="branchId" className="field__control" defaultValue={currentBranchId ?? ""} required>
        {currentBranchId ? null : <option value="" disabled>Seleccione…</option>}
        {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
      <button type="submit" className="btn btn--small" disabled={pending}>{pending ? "Guardando…" : "Asignar"}</button>
      {state.message ? (
        <p className={state.ok ? "field__hint" : "field__error"} role={state.ok ? "status" : "alert"}>{state.message}</p>
      ) : null}
    </form>
  );
}
