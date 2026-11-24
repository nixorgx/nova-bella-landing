"use server";

import { revalidatePath } from "next/cache";
import { requireRole, toSession } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { withUser } from "@/lib/db";
import { friendlyDbMessage } from "@/lib/db-errors";
import { createSellerSchema, setActiveSchema } from "./schemas";

export interface UserFormState {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /** Echoed back (never the password) so a failed submit does not wipe the form. */
  readonly values?: Readonly<Record<string, string>>;
}

function firstErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

export async function createSellerAction(
  _previous: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const actor = await requireRole("superadmin");
  const raw = {
    username: String(formData.get("username") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    branchId: String(formData.get("branchId") ?? ""),
  };
  const parsed = createSellerSchema.safeParse({ ...raw, password: formData.get("password") });
  if (!parsed.success) {
    return { ok: false, fieldErrors: firstErrors(parsed.error.issues), values: raw };
  }

  const { username, fullName, branchId, password } = parsed.data;
  const hash = await hashPassword(password);
  try {
    await withUser(toSession(actor), (client) =>
      client.query(
        `insert into users (username, full_name, password_hash, role, branch_id)
         values ($1, $2, $3, 'seller', $4)`,
        [username, fullName, hash, branchId],
      ),
    );
  } catch (error) {
    const duplicate = (error as { code?: string }).code === "23505";
    return {
      ok: false,
      message: duplicate ? "Ese nombre de usuario ya existe." : friendlyDbMessage(error),
      values: raw,
    };
  }
  revalidatePath("/usuarios");
  return { ok: true, message: `Vendedor “${username}” creado.` };
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  const actor = await requireRole("superadmin");
  const parsed = setActiveSchema.safeParse({
    userId: formData.get("userId"),
    active: formData.get("active"),
  });
  if (!parsed.success || parsed.data.userId === actor.id) return;

  await withUser(toSession(actor), (client) =>
    client.query("update users set active = $2 where id = $1 and role = 'seller'", [
      parsed.data.userId,
      parsed.data.active,
    ]),
  );
  revalidatePath("/usuarios");
}
