"use client";

import { useActionState, useTransition } from "react";
import { IDLE_FORM } from "@/lib/form";
import { setPublishedAction } from "../actions";

/** Buttons for the catalog table: checkboxes in the table point here through the `form` attribute. */
export function BulkPublishBar({ ready }: { ready: number }) {
  const [state, formAction, pending] = useActionState(setPublishedAction, IDLE_FORM);
  const [, startTransition] = useTransition();
  return (
    <form
      id="bulk-publish"
      className="bulk-bar"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(event.currentTarget);
        data.set("mode", submitter?.value ?? "publish");
        startTransition(() => formAction(data));
      }}
    >
      <span className="bulk-bar__label">Tienda online:</span>
      <button className="btn btn--small" type="submit" value="publish" disabled={pending}>Publicar seleccionados</button>
      <button className="btn btn--small btn--quiet" type="submit" value="unpublish" disabled={pending}>Quitar seleccionados</button>
      <button className="btn btn--small btn--primary" type="submit" value="publish_ready" disabled={pending || ready === 0}>
        Publicar todos los listos ({ready})
      </button>
      {state.message ? <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
    </form>
  );
}
