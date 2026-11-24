import { randomBytes } from "node:crypto";

/** Same minimum the app enforces for new users (src/features/users/schemas.ts). */
export const MIN_SEED_PASSWORD_LENGTH = 12;

export interface SeedUser {
  readonly username: string;
  readonly fullName: string;
  readonly role: "superadmin" | "seller";
  /** Environment variable that carries the initial password. */
  readonly passwordEnv: "SEED_SUPERADMIN_PASSWORD" | "SEED_SELLER_PASSWORD";
}

/** Same shape the database enforces on `users.username` (always lowercase; login ignores case). */
const SEED_USERNAME = /^[a-z0-9._-]{3,32}$/;
export const DEFAULT_SUPERADMIN_USERNAME = "naty";

export const SEED_USERS: readonly SeedUser[] = [
  { username: "naty", fullName: "Naty (Superadmin)", role: "superadmin", passwordEnv: "SEED_SUPERADMIN_PASSWORD" },
  { username: "vendedor1", fullName: "Vendedor Uno", role: "seller", passwordEnv: "SEED_SELLER_PASSWORD" },
];

export interface ResolvedSeedUser extends SeedUser {
  readonly password: string;
  /** True when the password was generated (and must be shown once) instead of read from env. */
  readonly generated: boolean;
}

/** A random password that always satisfies the 12+ character policy. */
export function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Initial passwords come from SEED_SUPERADMIN_PASSWORD / SEED_SELLER_PASSWORD. When one is
 * missing a random one is generated (development only: the seed is disabled in production).
 * Nothing is ever hardcoded.
 */
export function resolveSeedUsers(
  env: Readonly<Record<string, string | undefined>> = process.env,
  generate: () => string = generatePassword,
): readonly ResolvedSeedUser[] {
  const adminUsername = (env.SEED_SUPERADMIN_USERNAME ?? "").trim().toLowerCase() || DEFAULT_SUPERADMIN_USERNAME;
  if (!SEED_USERNAME.test(adminUsername)) {
    throw new Error("SEED_SUPERADMIN_USERNAME debe tener 3 a 32 caracteres: letras, números, punto o guion.");
  }
  return SEED_USERS.map((base) => {
    const user = base.role === "superadmin" ? { ...base, username: adminUsername } : base;
    const fromEnv = env[user.passwordEnv];
    if (fromEnv === undefined || fromEnv === "") {
      return { ...user, password: generate(), generated: true };
    }
    if (fromEnv.length < MIN_SEED_PASSWORD_LENGTH) {
      throw new Error(`${user.passwordEnv} debe tener al menos ${MIN_SEED_PASSWORD_LENGTH} caracteres.`);
    }
    return { ...user, password: fromEnv, generated: false };
  });
}
