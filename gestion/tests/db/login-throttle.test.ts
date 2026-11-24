import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { clearSharedAttempts, reserveSharedAttempt } from "@/lib/auth/auth-db";
import { clearSharedLoginAttempts, MAX_LOGIN_ATTEMPTS, reserveSharedLoginAttempt, type SharedThrottle } from "@/lib/auth/rate-limit";
import { authQuery, getPool } from "@/lib/db";
import { expectPgError, newId } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

const store: SharedThrottle = { reserve: reserveSharedAttempt, clear: clearSharedAttempts };
const WINDOW = 15 * 60 * 1000;

describe("database-backed login throttle (shared by every instance)", () => {
  it("allows up to the limit and then blocks with a wait time, without counting the blocked tries", async () => {
    const key = `t:${newId()}`;
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await reserveSharedAttempt(key, 3, WINDOW));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterMs).toBeGreaterThan(0);
    expect(results[3].retryAfterMs).toBeLessThanOrEqual(WINDOW);
    const { rows } = await systemQuery("select attempts from auth_login_attempts where key = $1", [key]);
    expect(rows[0].attempts).toBe(3);
  });

  it("is atomic under parallel guesses", async () => {
    const key = `t:${newId()}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveSharedAttempt(key, 5, WINDOW)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("starts a new window once the old one ended and can be cleared after a successful login", async () => {
    const key = `t:${newId()}`;
    await reserveSharedAttempt(key, 1, WINDOW);
    expect((await reserveSharedAttempt(key, 1, WINDOW)).allowed).toBe(false);
    await systemQuery("update auth_login_attempts set window_start = now() - interval '20 minutes' where key = $1", [key]);
    expect((await reserveSharedAttempt(key, 1, WINDOW)).allowed).toBe(true);
    await clearSharedAttempts(key);
    expect((await reserveSharedAttempt(key, 1, WINDOW)).allowed).toBe(true);
  });

  it("applies the pair limit and the per-user limit through the login helpers", async () => {
    const username = `u${randomUUID().slice(0, 8)}`;
    const answers = [];
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS + 2; i += 1) answers.push((await reserveSharedLoginAttempt(username, "10.0.0.1", store)).allowed);
    expect(answers.filter(Boolean)).toHaveLength(MAX_LOGIN_ATTEMPTS);
    // another IP is still allowed for the pair, and a successful login clears both counters
    expect((await reserveSharedLoginAttempt(username, "10.0.0.2", store)).allowed).toBe(true);
    await clearSharedLoginAttempts(username, "10.0.0.1", store);
    expect((await reserveSharedLoginAttempt(username, "10.0.0.1", store)).allowed).toBe(true);
  });

  it("rejects absurd parameters and the table itself is not reachable by the auth login", async () => {
    await expectPgError(authQuery("select * from auth_reserve_attempt('', 5, 60)"), "IN003");
    await expectPgError(authQuery("select * from auth_reserve_attempt('k', 0, 60)"), "IN003");
    await expectPgError(authQuery("select * from auth_reserve_attempt('k', 5, 0)"), "IN003");
    await expectPgError(authQuery("select * from auth_login_attempts"), "42501");
    expect(getPool("auth")).toBeDefined();
  });
});
