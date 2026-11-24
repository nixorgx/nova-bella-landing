"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearSharedAttempts, findLoginRecord, recordLogin, reserveSharedAttempt, type LoginRecord } from "@/lib/auth/auth-db";
import { verifyPassword } from "@/lib/auth/password";
import {
  clearLoginAttempts,
  clearSharedLoginAttempts,
  clientIpFromForwardedFor,
  reserveLoginAttempt,
  reserveSharedLoginAttempt,
  type RateLimitStatus,
  type SharedThrottle,
} from "@/lib/auth/rate-limit";
import { homeFor, LOGIN_PATH } from "@/lib/auth/routes";
import { encodeSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { trustedProxyHops } from "@/lib/env";
import { loginSchema } from "./schemas";

export interface LoginState {
  readonly error?: string;
  /** Echoed back so a failed attempt does not clear the username field. */
  readonly username?: string;
}

const GENERIC_ERROR = "Usuario o contraseña incorrectos.";
const sharedThrottle: SharedThrottle = { reserve: reserveSharedAttempt, clear: clearSharedAttempts };
const UNAVAILABLE = "No se pudo conectar con el sistema. Intente nuevamente.";

async function clientIp(): Promise<string> {
  return clientIpFromForwardedFor((await headers()).get("x-forwarded-for"), trustedProxyHops());
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  const typedUsername = String(formData.get("username") ?? "");
  if (!parsed.success) return { error: "Ingrese su usuario y contraseña.", username: typedUsername };

  // The attempt slot is taken BEFORE the (slow) bcrypt check: parallel guesses cannot
  // all pass a "not blocked yet" test, and a successful login gives the slot back.
  const ip = await clientIp();
  let status: RateLimitStatus = reserveLoginAttempt(parsed.data.username, ip);
  if (status.allowed) {
    try {
      // Shared across every server instance (the in-memory limiter above is per process).
      status = await reserveSharedLoginAttempt(parsed.data.username, ip, sharedThrottle);
    } catch {
      return { error: UNAVAILABLE, username: typedUsername };
    }
  }
  if (!status.allowed) {
    const minutes = Math.max(1, Math.ceil(status.retryAfterMs / 60_000));
    return { error: `Demasiados intentos. Espere ${minutes} min e intente de nuevo.`, username: typedUsername };
  }

  let user: LoginRecord | null;
  try {
    user = await findLoginRecord(parsed.data.username);
  } catch {
    return { error: UNAVAILABLE, username: typedUsername };
  }
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? null);
  if (!user || !valid) return { error: GENERIC_ERROR, username: typedUsername };

  clearLoginAttempts(parsed.data.username, ip);
  await clearSharedLoginAttempts(parsed.data.username, ip, sharedThrottle).catch(() => undefined);
  await recordLogin(user.id);
  const token = await encodeSession({
    userId: user.id,
    role: user.role,
    branchId: user.branchId,
    tokenVersion: user.tokenVersion,
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  redirect(homeFor(user.role));
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect(LOGIN_PATH);
}
