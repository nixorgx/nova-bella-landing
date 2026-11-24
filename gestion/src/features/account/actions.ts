"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSharedAttempts, findLoginRecord, reserveSharedAttempt } from "@/lib/auth/auth-db";
import { requireRole, requireSessionUser, toSession } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { LOGIN_WINDOW_MS } from "@/lib/auth/rate-limit";
import { homeFor } from "@/lib/auth/routes";
import { encodeSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { friendlyDbMessage } from "@/lib/db-errors";
import { changePasswordSchema, resetPasswordSchema } from "./schemas";
import { generatePassphrase } from "./passphrase";
import { MAX_PASSWORD_CHANGE_ATTEMPTS, passwordChangeKey } from "./throttle";

export interface PasswordFormState {
  readonly ok: boolean;
  readonly message?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  /** Only set by a superadmin reset: shown once so it can be handed over. Never stored or logged. */
  readonly temporaryPassword?: string;
  readonly targetUsername?: string;
}

const UNAVAILABLE = "No se pudo conectar con el sistema. Intente nuevamente.";
const WRONG_CURRENT = "La contraseña actual no es correcta.";

function firstErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) errors[String(issue.path[0] ?? "form")] ??= issue.message;
  return errors;
}

/**
 * "Cambiar mi contraseña": any signed-in user, only their own. The current password is verified
 * here (bcrypt) behind the shared database throttle; the write itself is the SECURITY DEFINER
 * function change_own_password, which takes the identity from the signed request context.
 */
export async function changeOwnPasswordAction(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const user = await requireSessionUser();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues) };
  const { currentPassword, newPassword } = parsed.data;

  const key = passwordChangeKey(user.id);
  let current: Awaited<ReturnType<typeof findLoginRecord>>;
  try {
    // The slot is taken BEFORE the (slow) bcrypt check so parallel guesses cannot all slip through.
    const status = await reserveSharedAttempt(key, MAX_PASSWORD_CHANGE_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!status.allowed) {
      const minutes = Math.max(1, Math.ceil(status.retryAfterMs / 60_000));
      return { ok: false, message: `Demasiados intentos. Espere ${minutes} min e intente de nuevo.` };
    }
    current = await findLoginRecord(user.username);
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }
  const valid = await verifyPassword(currentPassword, current?.passwordHash ?? null);
  if (!current || !valid) return { ok: false, fieldErrors: { currentPassword: WRONG_CURRENT } };

  const newHash = await hashPassword(newPassword);
  let version: number;
  try {
    const result = await withUser(toSession(user), (client) =>
      client.query<{ version: number }>("select change_own_password($1, $2) as version", [current.passwordHash, newHash]),
    );
    version = Number(result.rows[0].version);
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
  await clearSharedAttempts(key).catch(() => undefined);

  // Every other session died with the token_version bump; this one gets a fresh cookie.
  const token = await encodeSession({ userId: user.id, role: user.role, branchId: user.branchId, tokenVersion: version });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  if (user.mustChangePassword) redirect(homeFor(user.role));
  revalidatePath("/cuenta/contrasena");
  return { ok: true, message: "Su contraseña se cambió. Las demás sesiones abiertas se cerraron." };
}

/** Superadmin: new (temporary) password for another account; optionally forces a change at next sign-in. */
export async function resetUserPasswordAction(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const actor = await requireRole("superadmin");
  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    newPassword: formData.get("newPassword"),
    mustChange: formData.get("mustChange") ?? undefined,
  });
  if (!parsed.success) return { ok: false, fieldErrors: firstErrors(parsed.error.issues) };
  const { userId, newPassword, mustChange } = parsed.data;
  if (userId === actor.id) {
    return { ok: false, message: "Para su propia cuenta use “Cambiar mi contraseña”." };
  }

  const hash = await hashPassword(newPassword);
  try {
    const result = await withUser(toSession(actor), async (client) => {
      await client.query("select admin_reset_password($1, $2, $3)", [userId, hash, mustChange]);
      return client.query<{ username: string }>("select username from users where id = $1", [userId]);
    });
    revalidatePath("/usuarios");
    return {
      ok: true,
      message: mustChange
        ? "Contraseña restablecida. La persona deberá cambiarla al ingresar."
        : "Contraseña restablecida. Sus sesiones abiertas se cerraron.",
      temporaryPassword: newPassword,
      targetUsername: result.rows[0]?.username,
    };
  } catch (error) {
    return { ok: false, message: friendlyDbMessage(error) };
  }
}

/** A readable passphrase suggestion (not stored anywhere until the superadmin submits the reset). */
export async function suggestPassphraseAction(): Promise<string> {
  await requireRole("superadmin");
  return generatePassphrase();
}
