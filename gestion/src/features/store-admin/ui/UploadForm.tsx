"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { IDLE_FORM, type FormState } from "@/lib/form";
import { CLIENT_UPLOAD_LIMIT, shrinkImage, TOO_BIG_MESSAGE } from "@/lib/client-image";

/** Image upload form: big phone/camera pictures are shrunk in the browser first (the server re-encodes anyway). */
export function UploadForm({ action, fileName, label, hint, submitLabel, children }: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  fileName: string;
  label: string;
  hint?: string;
  submitLabel: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form
      ref={ref}
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const file = data.get(fileName);
          if (file instanceof File && file.size > 0) {
            const small = await shrinkImage(file);
            if (small.size > CLIENT_UPLOAD_LIMIT) {
              setLocalError(TOO_BIG_MESSAGE);
              return;
            }
            data.set(fileName, small);
          }
          setLocalError(null);
          formAction(data);
        });
      }}
    >
      {localError ? <p className="notice notice--error" role="alert">{localError}</p> : null}
      {state.message ? <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
      {children}
      <div className="field">
        <label className="field__label" htmlFor={`up-${fileName}`}>{label}</label>
        <input id={`up-${fileName}`} className="field__control" type="file" name={fileName} accept="image/jpeg,image/png,image/webp" required />
        <p className="field__hint">{hint ?? "JPG, PNG o WebP. Se optimiza automáticamente."}</p>
      </div>
      <div className="form-actions">
        <button className="btn btn--primary" type="submit" disabled={pending}>{pending ? "Subiendo…" : submitLabel}</button>
      </div>
    </form>
  );
}
