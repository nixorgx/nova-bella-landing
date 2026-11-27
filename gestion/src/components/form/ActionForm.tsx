"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useTransition } from "react";
import { IDLE_FORM, type FormState } from "@/lib/form";

const FormStateContext = createContext<FormState>(IDLE_FORM);

/** Read by FormField & friends so server-rendered fields can show errors and echoed values. */
export function useFormState(): FormState {
  return useContext(FormStateContext);
}

interface ActionFormProps {
  readonly action: (previous: FormState, formData: FormData) => Promise<FormState>;
  readonly children: React.ReactNode;
  readonly submitLabel: string;
  readonly pendingLabel?: string;
  readonly resetOnSuccess?: boolean;
  readonly onSuccess?: () => void;
  readonly className?: string;
  readonly secondary?: React.ReactNode;
  readonly hideSubmit?: boolean;
  readonly submitClassName?: string;
  readonly submitDisabled?: boolean;
}

/** Client form shell around a server action: pending state, notice, reset on success. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Guardando…",
  resetOnSuccess = false,
  onSuccess,
  className,
  secondary,
  hideSubmit = false,
  submitClassName = "btn btn--primary",
  submitDisabled = false,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef(onSuccess);

  useEffect(() => {
    successRef.current = onSuccess;
  });

  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) formRef.current?.reset();
    successRef.current?.();
  }, [state, resetOnSuccess]);

  return (
    <FormStateContext.Provider value={state}>
      <form
        ref={formRef}
        className={className ?? "stack"}
        noValidate
        // Not `action={...}`: React would reset every field after each submit and wipe what the
        // user typed when the server reports an error. We reset ourselves on success only.
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        {state.message ? (
          <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>
            {state.message}
          </p>
        ) : null}
        {children}
        {hideSubmit ? null : (
          <div className="form-actions">
            <button className={submitClassName} type="submit" disabled={pending || submitDisabled}>
              {pending ? pendingLabel : submitLabel}
            </button>
            {secondary}
          </div>
        )}
      </form>
    </FormStateContext.Provider>
  );
}
