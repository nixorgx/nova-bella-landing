import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadAuthRecord } from "./auth-db";
import { CHANGE_PASSWORD_PATH, homeFor, LOGIN_PATH, SESSION_RESET_PATH } from "./routes";
import { decodeSession, SESSION_COOKIE, type Role, type SessionPayload } from "./session";

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly fullName: string;
  readonly role: Role;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly mustChangePassword: boolean;
}

async function loadActiveUser(session: SessionPayload): Promise<AuthUser | null> {
  const record = await loadAuthRecord(session.userId);
  // A token minted before the last password change / deactivation / logout-all is dead.
  if (!record || record.tokenVersion !== session.tokenVersion) return null;
  return {
    id: record.id,
    username: record.username,
    fullName: record.fullName,
    role: record.role,
    branchId: record.branchId,
    branchName: record.branchName,
    mustChangePassword: record.mustChangePassword === true,
  };
}

/**
 * Signed-in user, re-validated against the database on every request so a deactivated or
 * re-assigned account loses access immediately (the cookie only proves identity). Includes users
 * that still have to change a temporary password; most callers want `getCurrentUser` instead.
 */
export const getSessionUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await decodeSession(token);
  if (!session) return null;
  return loadActiveUser(session);
});

/**
 * Current user for pages, actions and APIs. A user who must still change a temporary password
 * is NOT usable here: nothing works for them except the password change page.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const user = await getSessionUser();
  return user && !user.mustChangePassword ? user : null;
}

/** Signed in (even with a pending forced change). Used by the password change page and the shell. */
export async function requireSessionUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (user) return user;
  // A leftover cookie that no longer maps to a live user (deactivated, password changed,
  // logout-all) must be cleared first, otherwise the proxy would bounce /login straight back.
  const hasCookie = Boolean((await cookies()).get(SESSION_COOKIE)?.value);
  redirect(hasCookie ? SESSION_RESET_PATH : LOGIN_PATH);
}

export async function requireUser(): Promise<AuthUser> {
  const user = await requireSessionUser();
  if (user.mustChangePassword) redirect(CHANGE_PASSWORD_PATH);
  return user;
}

/** Requires one of the roles; others are sent to their own home page. */
export async function requireRole(...roles: readonly Role[]): Promise<AuthUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** The identity handed to withUser(): always built from DB-verified data. */
export function toSession(user: AuthUser): SessionPayload {
  return { userId: user.id, role: user.role, branchId: user.branchId };
}
