import bcrypt from "bcryptjs";
import { bcryptCost } from "@/lib/env";

/** Hashes a new password with the configured work factor (12 unless BCRYPT_COST says otherwise). */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, bcryptCost());
}

let dummyHash: Promise<string> | undefined;

/**
 * A hash with the SAME cost as real ones, so verifying a password for an unknown user
 * takes as long as for a known one (no user enumeration through timing).
 */
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("dummy-password-for-timing-equalisation", bcryptCost());
  return dummyHash;
}

/** Verifies `password`; with no stored hash it burns equivalent time and returns false. */
export async function verifyPassword(password: string, storedHash: string | null): Promise<boolean> {
  const valid = await bcrypt.compare(password, storedHash ?? (await getDummyHash()));
  return storedHash !== null && valid;
}
