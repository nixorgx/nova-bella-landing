"use client";

import { useActionState } from "react";
import { IDLE_FORM } from "@/lib/form";
import { setBranchActiveAction } from "../actions";

interface Props {
  readonly branchId: string;
  readonly name: string;
  readonly active: boolean;
  /** Reasons the database would refuse to deactivate; the button is disabled while any remains. */
  readonly blockers: readonly string[];
}

export function BranchActiveForm({ branchId, name, active, blockers }: Props) {
  const [state, action, pending] = useActionState(setBranchActiveAction, IDLE_FORM);
  const blocked = active && blockers.length > 0;
  return (
    <form action={action} className="branch-toggle">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="active" value={String(!active)} />
      <button
        type="submit"
        className={`btn btn--small ${active ? "btn--danger" : ""}`}
        disabled={pending || blocked}
        aria-describedby={blocked ? `blockers-${branchId}` : undefined}
        aria-label={`${active ? "Desactivar" : "Activar"} ${name}`}
      >
        {active ? "Desactivar" : "Activar"}
      </button>
      {state.message && !state.ok ? <p className="field__error" role="alert">{state.message}</p> : null}
    </form>
  );
}
