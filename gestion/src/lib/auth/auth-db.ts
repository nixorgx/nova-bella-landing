import { authQuery } from "@/lib/db";
import type { Role } from "./session";

/** What the login flow needs from a user row (never leaves the server). */
export interface LoginRecord {
  readonly id: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly branchId: string | null;
  readonly tokenVersion: number;
}

export interface AuthRecord {
  readonly id: string;
  readonly username: string;
  readonly fullName: string;
  readonly role: Role;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly tokenVersion: number;
  /** Set by a superadmin reset: the user must choose a new password before doing anything else. */
  readonly mustChangePassword: boolean;
}

interface LoginRow {
  id: string;
  password_hash: string;
  role: Role;
  branch_id: string | null;
  token_version: number;
}

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  branch_id: string | null;
  branch_name: string | null;
  token_version: number;
  must_change_password: boolean;
}

/** Active users only; sellers of an inactive branch are not found. */
export async function findLoginRecord(username: string): Promise<LoginRecord | null> {
  const { rows } = await authQuery<LoginRow>("select * from auth_login_lookup($1)", [username]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    passwordHash: row.password_hash,
    role: row.role,
    branchId: row.branch_id,
    tokenVersion: row.token_version,
  };
}

export async function recordLogin(userId: string): Promise<void> {
  await authQuery("select auth_record_login($1)", [userId]);
}

/** Active user whose branch (for sellers) is also active. */
export async function loadAuthRecord(userId: string): Promise<AuthRecord | null> {
  const { rows } = await authQuery<UserRow>("select * from auth_load_user($1)", [userId]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    branchId: row.branch_id,
    branchName: row.branch_name,
    tokenVersion: row.token_version,
    mustChangePassword: row.must_change_password,
  };
}

export interface SharedAttemptStatus {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

/** Takes one slot in the database-backed (multi-instance) login throttle. */
export async function reserveSharedAttempt(key: string, max: number, windowMs: number): Promise<SharedAttemptStatus> {
  const { rows } = await authQuery<{ allowed: boolean; retry_after_seconds: number }>(
    "select * from auth_reserve_attempt($1, $2, $3)",
    [key, max, Math.ceil(windowMs / 1000)],
  );
  const row = rows[0];
  return { allowed: row?.allowed ?? false, retryAfterMs: (row?.retry_after_seconds ?? 0) * 1000 };
}

export async function clearSharedAttempts(key: string): Promise<void> {
  await authQuery("select auth_clear_attempts($1)", [key]);
}
