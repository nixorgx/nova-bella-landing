/** Shape returned by every catalog server action used through useActionState. */
export interface FormState {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /** Echoed back so a failed submit does not wipe what the user typed. */
  readonly values?: Readonly<Record<string, string>>;
}

export const IDLE_FORM: FormState = { ok: false };

/** First message per field from a zod issue list. */
export function firstErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

/** Flattens FormData into strings (files and repeated keys keep the last value). */
export function formToValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
