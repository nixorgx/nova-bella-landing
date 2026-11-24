import { createHash, createHmac } from "node:crypto";

/**
 * Order access tokens. The buyer's link carries a 256-bit token. The database stores only its SHA-256
 * (so a database leak cannot be turned into working links). The token is derived from the checkout's
 * idempotency key with an HMAC keyed by a server secret, which makes a retried/double-submitted checkout
 * return the SAME token (the plain token is never stored anywhere).
 *
 * The idempotency key is generated in the buyer's browser (128-bit random). Without the server secret
 * nobody can compute the token, not even someone who learns a key.
 */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function deriveOrderToken(idempotencyKey: string, secret: string): string {
  return createHmac("sha256", secret).update(`order-token|${idempotencyKey}`).digest("base64url");
}

export function hashOrderToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** Cheap shape check before touching the database (no timing concerns: the lookup is by hash). */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
