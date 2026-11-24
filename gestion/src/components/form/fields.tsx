"use client";

import { useId } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useFormState } from "./ActionForm";

interface Base {
  readonly label: string;
  readonly name: string;
  readonly hint?: string;
  readonly id?: string;
}

function Wrapper({
  inputId,
  label,
  hint,
  error,
  children,
}: {
  inputId: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={inputId}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="field__hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(inputId: string, error?: string, hint?: string): string | undefined {
  const ids = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

export function FormField({
  label,
  name,
  hint,
  id,
  defaultValue,
  className,
  ...rest
}: Base & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "id">) {
  const state = useFormState();
  const generated = useId();
  const inputId = id ?? generated;
  const error = state.fieldErrors?.[name];
  return (
    <Wrapper inputId={inputId} label={label} hint={hint} error={error}>
      <input
        {...rest}
        id={inputId}
        name={name}
        defaultValue={defaultValue}
        className={className ? `field__control ${className}` : "field__control"}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
      />
    </Wrapper>
  );
}

export function FormTextarea({
  label,
  name,
  hint,
  id,
  defaultValue,
  ...rest
}: Base & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "id">) {
  const state = useFormState();
  const generated = useId();
  const inputId = id ?? generated;
  const error = state.fieldErrors?.[name];
  return (
    <Wrapper inputId={inputId} label={label} hint={hint} error={error}>
      <textarea
        {...rest}
        id={inputId}
        name={name}
        defaultValue={defaultValue}
        className="field__control field__control--area"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
      />
    </Wrapper>
  );
}

export function FormSelect({
  label,
  name,
  hint,
  id,
  defaultValue,
  children,
  ...rest
}: Base & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name" | "id">) {
  const state = useFormState();
  const generated = useId();
  const inputId = id ?? generated;
  const error = state.fieldErrors?.[name];
  return (
    <Wrapper inputId={inputId} label={label} hint={hint} error={error}>
      <select
        {...rest}
        id={inputId}
        name={name}
        defaultValue={defaultValue}
        className="field__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, error, hint)}
      >
        {children}
      </select>
    </Wrapper>
  );
}

export function FormCheckbox({
  label,
  name,
  defaultChecked,
}: {
  readonly label: string;
  readonly name: string;
  readonly defaultChecked?: boolean;
}) {
  return (
    <label className="check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}
