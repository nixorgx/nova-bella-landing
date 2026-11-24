import { describe, expect, it } from "vitest";
import {
  clientIpFromForwardedFor,
  clearLoginAttempts,
  createRateLimiter,
  getLoginLimiters,
  loginKey,
  reserveLoginAttempt,
  userKey,
} from "@/lib/auth/rate-limit";

function setup(options: { maxEntries?: number; pruneIntervalMs?: number } = {}) {
  let now = 1_000;
  const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000, now: () => now, ...options });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe("rate limiter", () => {
  it("reserves the slot up front: allows maxAttempts, then blocks with a retry time", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) expect(limiter.reserve("k").allowed).toBe(true);
    const status = limiter.reserve("k");
    expect(status.allowed).toBe(false);
    expect(status.retryAfterMs).toBe(60_000);
  });

  it("counts parallel attempts atomically (no check-then-increment gap)", () => {
    const { limiter } = setup();
    // Ten requests arriving "at once" each reserve before any password is verified.
    const results = Array.from({ length: 10 }, () => limiter.reserve("k").allowed);
    expect(results.filter(Boolean)).toHaveLength(3);
  });

  it("tracks keys independently", () => {
    const { limiter } = setup();
    for (let i = 0; i < 4; i++) limiter.reserve("a");
    expect(limiter.reserve("a").allowed).toBe(false);
    expect(limiter.reserve("b").allowed).toBe(true);
  });

  it("expires after the window", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 4; i++) limiter.reserve("k");
    advance(60_000);
    expect(limiter.reserve("k").allowed).toBe(true);
  });

  it("resets on success", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.reserve("k");
    limiter.reset("k");
    expect(limiter.reserve("k").allowed).toBe(true);
  });

  it("never grows past maxEntries, evicting the oldest entry", () => {
    const { limiter } = setup({ maxEntries: 3 });
    for (let i = 0; i < 50; i++) limiter.reserve(`user-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(3);
  });

  it("prunes expired entries periodically", () => {
    const { limiter, advance } = setup({ pruneIntervalMs: 10_000 });
    for (let i = 0; i < 20; i++) limiter.reserve(`user-${i}`);
    expect(limiter.size()).toBe(20);
    advance(61_000);
    limiter.reserve("fresh");
    expect(limiter.size()).toBe(1);
  });
});

describe("login limiters", () => {
  it("normalizes keys and shares global limiters", () => {
    expect(loginKey("  Naty ", "1.2.3.4")).toBe("naty|1.2.3.4");
    expect(userKey("  Naty ")).toBe("naty");
    expect(getLoginLimiters()).toBe(getLoginLimiters());
  });

  it("limits per username regardless of IP (distributed guessing)", () => {
    const username = `victima-${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 40; i++) {
      if (reserveLoginAttempt(username, `10.0.0.${i}`).allowed) allowed++;
    }
    expect(allowed).toBe(20);
    clearLoginAttempts(username, "10.0.0.1");
    expect(reserveLoginAttempt(username, "10.0.0.99").allowed).toBe(true);
  });

  it("limits per username+IP more tightly", () => {
    const username = `otro-${Math.random()}`;
    const results = Array.from({ length: 8 }, () => reserveLoginAttempt(username, "9.9.9.9").allowed);
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(reserveLoginAttempt(username, "8.8.8.8").allowed).toBe(true);
  });
});

describe("clientIpFromForwardedFor", () => {
  it("ignores X-Forwarded-For unless a proxy is trusted", () => {
    expect(clientIpFromForwardedFor("6.6.6.6", 0)).toBe("unknown");
  });

  it("uses the rightmost hop appended by the trusted proxy, not the spoofable leftmost one", () => {
    expect(clientIpFromForwardedFor("6.6.6.6, 203.0.113.7", 1)).toBe("203.0.113.7");
    expect(clientIpFromForwardedFor("6.6.6.6, 203.0.113.7, 10.0.0.2", 2)).toBe("203.0.113.7");
  });

  it("falls back to unknown for missing, short or malformed values", () => {
    expect(clientIpFromForwardedFor(null, 1)).toBe("unknown");
    expect(clientIpFromForwardedFor("1.1.1.1", 2)).toBe("unknown");
    expect(clientIpFromForwardedFor("<script>", 1)).toBe("unknown");
    expect(clientIpFromForwardedFor("a".repeat(100), 1)).toBe("unknown");
  });

  it("accepts IPv6", () => {
    expect(clientIpFromForwardedFor("2001:db8::1", 1)).toBe("2001:db8::1");
  });
});
