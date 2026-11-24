"use client";

import { useActionState, useState } from "react";
import { ActionForm } from "@/components/form/ActionForm";
import { IDLE_FORM, type FormState } from "@/lib/form";
import { deleteEntityAction } from "../entity-actions";

interface Props {
  readonly entity: "line" | "color" | "size" | "model";
  readonly id: string;
  readonly summary: React.ReactNode;
  /** Server-rendered <FormField>s with the current values as defaults. */
  readonly fields: React.ReactNode;
  readonly action: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** Server-rendered activate/deactivate button. */
  readonly toggle: React.ReactNode;
  readonly inUse: boolean;
  readonly active: boolean;
  readonly editLabel: string;
}

/** A list row that expands into an edit form; unused entries can also be deleted. */
export function EditableRow({ entity, id, summary, fields, action, toggle, inUse, active, editLabel }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteState, deleteAction, deleting] = useActionState(deleteEntityAction, IDLE_FORM);

  return (
    <li className={`attr-row ${active ? "" : "is-off"}`}>
      <div className="attr-row__main">
        <div className="attr-row__summary">{summary}</div>
        <div className="attr-row__actions">
          <button
            type="button"
            className="btn btn--small btn--quiet"
            aria-expanded={editing}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Cerrar" : "Editar"}
            <span className="sr-only"> {editLabel}</span>
          </button>
          {toggle}
        </div>
      </div>
      {editing ? (
        <div className="attr-row__edit">
          <ActionForm
            action={action}
            submitLabel="Guardar cambios"
            onSuccess={() => setEditing(false)}
            secondary={
              inUse ? (
                <span className="field__hint">En uso: se puede desactivar, no eliminar.</span>
              ) : confirming ? null : (
                <button type="button" className="btn btn--small btn--danger" onClick={() => setConfirming(true)}>
                  Eliminar
                </button>
              )
            }
          >
            <input type="hidden" name="id" value={id} />
            {fields}
          </ActionForm>
          {confirming && !inUse ? (
            <form action={deleteAction} className="confirm">
              <input type="hidden" name="entity" value={entity} />
              <input type="hidden" name="id" value={id} />
              <p>¿Eliminar definitivamente {editLabel}? No se puede deshacer.</p>
              <div className="form-actions">
                <button type="submit" className="btn btn--small btn--danger" disabled={deleting}>
                  {deleting ? "Eliminando…" : "Sí, eliminar"}
                </button>
                <button type="button" className="btn btn--small btn--quiet" onClick={() => setConfirming(false)}>
                  Cancelar
                </button>
              </div>
              {deleteState.message && !deleteState.ok ? (
                <p className="field__error" role="alert">
                  {deleteState.message}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
