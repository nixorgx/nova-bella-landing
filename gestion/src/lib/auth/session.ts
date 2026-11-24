import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { cookieSecure, getSessionSecret } from "@/lib/env";

export const SESSION_COOKIE = "inv_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // one shop day
export const SESSION_ISSUER = "inventario-naty";
export const SESSION_AUDIENCE = "inventario-naty-app";

export type Role = "superadmin" | "seller";

export interface SessionPayload {
  readonly userId: string;
  readonly role: Role;
  readonly branchId: string | null;
  /**
   * users.token_version at sign-in. Present on cookies, compared with the database on
   * every request (guards) so password changes / deactivation / logout-all kill old tokens.
   */
  readonly tokenVersion?: number;
}

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(["superadmin", "seller"]),
  branch: z.string().nullable().optional(),
  ver: z.number().int().nonnegative(),
});

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret());
}

export interface EncodeOptions {
  readonly ttlSeconds?: number;
}

/** Signs a session as an HS256 JWT. The token only carries identity, never data. */
export async function encodeSession(
  payload: SessionPayload,
  options: EncodeOptions = {},
): Promise<string> {
  const ttl = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: payload.role, branch: payload.branchId, ver: payload.tokenVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(secretKey());
}

/** Verifies signature, issuer, audience, expiry and claim shape. Returns null for anything invalid. */
export async function decodeSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    return {
      userId: claims.data.sub,
      role: claims.data.role,
      branchId: claims.data.branch ?? null,
      tokenVersion: claims.data.ver,
    };
  } catch {
    return null;
  }
}

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

/**
 * `secure` follows COOKIE_SECURE when set, otherwise it is on in production. Set
 * COOKIE_SECURE=false only for plain-HTTP staging (e.g. `next start` on localhost).
 */
export function sessionCookieOptions(
  maxAge: number = SESSION_TTL_SECONDS,
  env: Record<string, string | undefined> = process.env,
): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: cookieSecure(env), path: "/", maxAge };
}
