export interface RateLimiterOptions {
  readonly maxAttempts: number;
  readonly windowMs: number;
  /** Hard cap on tracked keys (memory bound against username spraying). */
  readonly maxEntries?: number;
  /** Minimum time between sweeps of expired entries. */
  readonly pruneIntervalMs?: number;
  readonly now?: () => number;
}

export interface RateLimitStatus {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

interface Entry {
  readonly attempts: number;
  readonly firstAt: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

/**
 * In-memory attempt limiter (per process). `reserve` checks AND counts in one
 * synchronous step, so concurrent requests cannot all slip through before the first
 * failure is recorded; call it BEFORE the expensive password check and `reset` on success.
 * Swap for a shared store if the app is ever scaled horizontally.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const clock = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const pruneIntervalMs = options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  const entries = new Map<string, Entry>();
  let lastPrune = clock();

  const expired = (entry: Entry, now: number): boolean => now - entry.firstAt >= options.windowMs;

  const prune = (now: number): void => {
    for (const [key, entry] of entries) {
      if (expired(entry, now)) entries.delete(key);
    }
    lastPrune = now;
  };

  const makeRoom = (now: number): void => {
    if (entries.size < maxEntries) return;
    prune(now);
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) return;
      entries.delete(oldest.value);
    }
  };

  return {
    reserve(key: string): RateLimitStatus {
      const now = clock();
      if (now - lastPrune >= pruneIntervalMs) prune(now);

      let entry = entries.get(key);
      if (entry && expired(entry, now)) {
        entries.delete(key);
        entry = undefined;
      }
      if (!entry) {
        makeRoom(now);
        entries.set(key, { attempts: 1, firstAt: now });
        return { allowed: true, retryAfterMs: 0 };
      }
      if (entry.attempts >= options.maxAttempts) {
        return { allowed: false, retryAfterMs: entry.firstAt + options.windowMs - now };
      }
      entries.set(key, { attempts: entry.attempts + 1, firstAt: entry.firstAt });
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(key: string): void {
      entries.delete(key);
    },
    size(): number {
      return entries.size;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Per username + IP. */
export const MAX_LOGIN_ATTEMPTS = 5;
/** Per username only (IP ignored): stops distributed guessing against one account. */
export const MAX_USER_LOGIN_ATTEMPTS = 20;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface LoginLimiters {
  readonly perPair: RateLimiter;
  readonly perUser: RateLimiter;
}

const globalForLimiter = globalThis as unknown as { __loginLimiters?: LoginLimiters };

/** Shared limiters for the login action (kept on globalThis across HMR). */
export function getLoginLimiters(): LoginLimiters {
  globalForLimiter.__loginLimiters ??= {
    perPair: createRateLimiter({ maxAttempts: MAX_LOGIN_ATTEMPTS, windowMs: LOGIN_WINDOW_MS }),
    perUser: createRateLimiter({ maxAttempts: MAX_USER_LOGIN_ATTEMPTS, windowMs: LOGIN_WINDOW_MS }),
  };
  return globalForLimiter.__loginLimiters;
}

export function loginKey(username: string, ip: string): string {
  return `${username.trim().toLowerCase()}|${ip}`;
}

export function userKey(username: string): string {
  return username.trim().toLowerCase();
}

/** Reserves one attempt on both limiters. Call before verifying the password. */
export function reserveLoginAttempt(username: string, ip: string): RateLimitStatus {
  const { perPair, perUser } = getLoginLimiters();
  const pair = perPair.reserve(loginKey(username, ip));
  const user = perUser.reserve(userKey(username));
  if (!pair.allowed) return pair;
  return user;
}

/** Clears both counters after a successful sign-in. */
export function clearLoginAttempts(username: string, ip: string): void {
  const { perPair, perUser } = getLoginLimiters();
  perPair.reset(loginKey(username, ip));
  perUser.reset(userKey(username));
}

const UNKNOWN_IP = "unknown";
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Client address from X-Forwarded-For. Anybody can send that header, so it is only
 * honoured behind `hops` trusted proxies (TRUST_PROXY): each proxy appends the address
 * it saw, so the entry `hops` places from the RIGHT is the one a trusted proxy wrote
 * and the client cannot forge. Without a trusted proxy the header is ignored.
 */
export function clientIpFromForwardedFor(header: string | null, hops: number): string {
  if (!header || hops <= 0) return UNKNOWN_IP;
  const parts = header
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - hops];
  return candidate && IP_SHAPE.test(candidate) ? candidate : UNKNOWN_IP;
}

export interface SharedThrottle {
  readonly reserve: (key: string, max: number, windowMs: number) => Promise<RateLimitStatus>;
  readonly clear: (key: string) => Promise<void>;
}

const SHARED_PREFIX = { pair: "login:pair:", user: "login:user:" } as const;

/**
 * Same two limits as the in-memory limiter, but kept in the database so every serverless instance
 * counts the same attempts. `reserveLoginAttempt` stays as the cheap first gate.
 */
export async function reserveSharedLoginAttempt(username: string, ip: string, store: SharedThrottle): Promise<RateLimitStatus> {
  const pair = await store.reserve(SHARED_PREFIX.pair + loginKey(username, ip), MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
  const user = await store.reserve(SHARED_PREFIX.user + userKey(username), MAX_USER_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
  return pair.allowed ? user : pair;
}

export async function clearSharedLoginAttempts(username: string, ip: string, store: SharedThrottle): Promise<void> {
  await Promise.all([
    store.clear(SHARED_PREFIX.pair + loginKey(username, ip)),
    store.clear(SHARED_PREFIX.user + userKey(username)),
  ]);
}
