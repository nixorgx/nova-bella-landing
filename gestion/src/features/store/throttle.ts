import { headers } from "next/headers";
import { clientIpFromForwardedFor } from "@/lib/auth/rate-limit";
import { publicQuery } from "@/lib/db";
import { trustedProxyHops } from "@/lib/env";

export interface Limit {
  /** Stable name of the limit; combined with the subject (ip / phone / token) into the stored key. */
  readonly name: string;
  readonly max: number;
  readonly windowSeconds: number;
}

/** Public endpoints, tuned so a real buyer never notices and a script runs out of attempts quickly. */
export const LIMITS = {
  checkoutIp: { name: "checkout-ip", max: 12, windowSeconds: 3600 },
  checkoutPhone: { name: "checkout-phone", max: 6, windowSeconds: 3600 },
  checkoutAll: { name: "checkout-all", max: 1000, windowSeconds: 3600 },
  cancelIp: { name: "cancel-ip", max: 30, windowSeconds: 3600 },
  proofToken: { name: "proof-token", max: 10, windowSeconds: 3600 },
  proofIp: { name: "proof-ip", max: 30, windowSeconds: 3600 },
  orderViewIp: { name: "order-view-ip", max: 240, windowSeconds: 600 },
  orderMissIp: { name: "order-miss-ip", max: 15, windowSeconds: 600 },
  cartIp: { name: "cart-ip", max: 300, windowSeconds: 600 },
  cancelToken: { name: "cancel-token", max: 5, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

export interface Reservation {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export function throttleKey(limit: Limit, subject: string): string {
  return `${limit.name}:${subject.slice(0, 100)}`;
}

/** Takes one slot of `limit` for `subject` in the database counter shared by every instance. Fails closed. */
export async function reserve(limit: Limit, subject: string): Promise<Reservation> {
  try {
    const { rows } = await publicQuery<{ allowed: boolean; retry_after_seconds: number }>(
      "select * from public_reserve_attempt($1, $2, $3)",
      [throttleKey(limit, subject), limit.max, limit.windowSeconds],
    );
    const row = rows[0];
    return { allowed: row?.allowed ?? false, retryAfterSeconds: row?.retry_after_seconds ?? limit.windowSeconds };
  } catch {
    return { allowed: false, retryAfterSeconds: 60 };
  }
}

export const UNKNOWN_IP = "unknown";

/**
 * Per-IP limit. Without a trusted proxy (TRUST_PROXY unset) the address is unknown and every visitor would share one
 * bucket, which would throttle the whole shop: then only the per-phone / per-token / global limits apply.
 * Production (Vercel) sets TRUST_PROXY=1, so real client addresses are used.
 */
export async function reserveIp(limit: Limit, ip: string): Promise<Reservation> {
  return ip === UNKNOWN_IP ? { allowed: true, retryAfterSeconds: 0 } : reserve(limit, ipBucket(ip));
}

/**
 * IPv4 addresses count one by one; IPv6 clients count per /64 (one household / one ISP customer owns a whole /64, so
 * counting full addresses would give an attacker billions of free buckets).
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = ip.includes("::") ? Math.max(0, 8 - left.length - right.length) : 0;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right].map((g) => g.padStart(4, "0"));
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** First limit that denies wins; later ones are not charged. */
export async function reserveAll(checks: readonly { limit: Limit; subject: string }[]): Promise<Reservation> {
  for (const { limit, subject } of checks) {
    const result = await reserve(limit, subject);
    if (!result.allowed) return result;
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function requestIp(): Promise<string> {
  return clientIpFromForwardedFor((await headers()).get("x-forwarded-for"), trustedProxyHops());
}

export function waitMessage(result: Reservation): string {
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return `Demasiados intentos. Espere ${minutes} min e intente de nuevo, o escríbanos por WhatsApp.`;
}
