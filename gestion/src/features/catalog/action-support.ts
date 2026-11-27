import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyDbMessage } from "@/lib/db-errors";
import type { FormState } from "@/lib/form";
import { CatalogError } from "./types";

export interface Outcome {
  readonly message: string;
  readonly redirectTo?: string;
}

/** Spanish message safe to show for any error raised by catalog work. */
export function describeError(error: unknown, duplicateMessage: string): string {
  if (error instanceof CatalogError) return error.message;
  if ((error as { code?: string }).code === "23505") return duplicateMessage;
  return friendlyDbMessage(error);
}

/** Every catalog page lives under /catalogo; a layout-level revalidation refreshes them all. */
export function revalidateCatalog(): void {
  revalidatePath("/catalogo", "layout");
}

/**
 * Runs `work`, turning failures into form state (with the typed values echoed back).
 * redirect() must run outside try/catch, so it happens after the work succeeded.
 */
export async function attempt(
  values: Readonly<Record<string, string>>,
  duplicateMessage: string,
  work: () => Promise<Outcome>,
): Promise<FormState> {
  let outcome: Outcome;
  try {
    outcome = await work();
  } catch (error) {
    return { ok: false, message: describeError(error, duplicateMessage), values };
  }
  revalidateCatalog();
  if (outcome.redirectTo) redirect(outcome.redirectTo);
  return { ok: true, message: outcome.message };
}

export function optionalId(value: string | undefined): string | null {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
