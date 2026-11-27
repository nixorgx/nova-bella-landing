"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { IDLE_FORM } from "@/lib/form";
import { CLIENT_UPLOAD_LIMIT, shrinkImage, TOO_BIG_MESSAGE } from "@/lib/client-image";
import { submitProofAction } from "../actions";

/** Buyer sends the payment proof: photo of the voucher and/or the bank transaction number. */
export function ProofForm({ token, hasProof }: { token: string; hasProof: boolean }) {
  const [state, formAction, pending] = useActionState(submitProofAction, IDLE_FORM);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="proof"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const file = data.get("proof");
          if (file instanceof File && file.size > 0) {
            const small = await shrinkImage(file);
            if (small.size > CLIENT_UPLOAD_LIMIT) {
              setLocalError(TOO_BIG_MESSAGE);
              return;
            }
            data.set("proof", small);
          }
          setLocalError(null);
          formAction(data);
        });
      }}
    >
      <h3>{hasProof ? "Enviar otro comprobante" : "Suba su comprobante"}</h3>
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label className="field__label" htmlFor="proof">Foto o captura del comprobante</label>
        <input id="proof" className="field__control" type="file" name="proof" accept="image/jpeg,image/png,image/webp" />
        <p className="field__hint">JPG, PNG o WebP. Máximo 4 MB.</p>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="reference">Número de transacción (opcional)</label>
        <input id="reference" className="field__control" type="text" name="reference" maxLength={60} autoComplete="off" />
        {state.fieldErrors?.reference ? <p className="field__error" role="alert">{state.fieldErrors.reference}</p> : null}
      </div>
      {localError ? <p className="notice notice--error" role="alert">{localError}</p> : null}
      {state.message ? (
        <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>
          {state.message}
        </p>
      ) : null}
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Enviar comprobante"}
      </button>
    </form>
  );
}
