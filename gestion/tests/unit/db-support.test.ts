import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { applyUserContext, signContext } from "@/lib/db-context";
import { friendlyDbMessage, isDomainError } from "@/lib/db-errors";
import {
  bcryptCost,
  cookieSecure,
  getContextSecret,
  getRuntimeDbEnv,
  getSessionSecret,
  parseBoolean,
  trustedProxyHops,
} from "@/lib/env";

describe("db errors", () => {
  it("passes domain error messages through", () => {
    const error = { code: "IN001", message: "Stock insuficiente para X" };
    expect(isDomainError(error)).toBe(true);
    expect(friendlyDbMessage(error)).toBe("Stock insuficiente para X");
  });

  it.each([
    ["23505", "Ya existe"],
    ["23503", "relacionado"],
    ["23514", "no es valido"],
    ["42501", "permiso"],
    ["22P02", "formato"],
    ["XX000", "inesperado"],
  ])("maps %s to a Spanish message", (code, fragment) => {
    expect(friendlyDbMessage({ code, message: "raw internal text" })).toContain(fragment);
    expect(friendlyDbMessage({ code, message: "raw internal text" })).not.toContain("raw internal");
  });

  it("handles non error values", () => {
    expect(isDomainError("boom")).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(friendlyDbMessage(undefined)).toContain("inesperado");
  });
});

const UID = "11111111-1111-4111-8111-111111111111";
const BID = "22222222-2222-4222-8222-222222222222";
const SECRET = "x".repeat(48);

describe("signContext", () => {
  it("signs user|branch|expiry with HMAC-SHA256", () => {
    const token = signContext({ userId: UID, branchId: BID }, SECRET, 1_700_000_000_000, 60);
    const [user, branch, expires, signature] = token.split(".");
    expect([user, branch, expires]).toEqual([UID, BID, "1700000060"]);
    expect(signature).toBe(
      createHmac("sha256", SECRET).update(`${UID}|${BID}|1700000060`).digest("hex"),
    );
  });

  it("uses '-' when the user has no branch and rejects malformed identities", () => {
    expect(signContext({ userId: UID, branchId: null }, SECRET).split(".")[1]).toBe("-");
    expect(() => signContext({ userId: "not-a-uuid", branchId: null }, SECRET)).toThrow();
    expect(() => signContext({ userId: UID, branchId: "x.y" }, SECRET)).toThrow();
  });
});

describe("applyUserContext", () => {
  it("publishes only the signed token (no role switch, no plain id settings)", async () => {
    const calls: [string, unknown[] | undefined][] = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        calls.push([text, values]);
        return undefined;
      },
    };
    await applyUserContext(client, { userId: UID, role: "seller", branchId: BID });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("set_config('app.ctx'");
    expect(calls[0][0]).not.toMatch(/role|app\.user_id|app\.branch_id/);
    const token = String((calls[0][1] ?? [])[0]);
    expect(token.startsWith(`${UID}.${BID}.`)).toBe(true);
  });

  it("refuses malformed identities", async () => {
    const client = { query: async () => undefined };
    await expect(
      applyUserContext(client, { userId: "u", role: "seller", branchId: null }),
    ).rejects.toThrow();
  });
});

describe("env helpers", () => {
  it("validates secrets and runtime URLs lazily", () => {
    expect(() => getSessionSecret({})).toThrow(/Configuracion invalida/);
    expect(() => getSessionSecret({ SESSION_SECRET: "short" })).toThrow(/32/);
    expect(getSessionSecret({ SESSION_SECRET: "s".repeat(32) })).toBe("s".repeat(32));
    expect(() => getContextSecret({ DB_CONTEXT_SECRET: "short" })).toThrow(/32/);
    expect(() => getRuntimeDbEnv({})).toThrow(/DATABASE_URL_SELLER/);
    const urls = { DATABASE_URL_SELLER: "a", DATABASE_URL_SUPERADMIN: "b", DATABASE_URL_AUTH: "c" };
    expect(getRuntimeDbEnv(urls)).toEqual(urls);
  });

  it("parses booleans with a fallback", () => {
    expect(parseBoolean("TRUE", false)).toBe(true);
    expect(parseBoolean("0", true)).toBe(false);
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean("maybe", false)).toBe(false);
  });

  it("COOKIE_SECURE defaults to production", () => {
    expect(cookieSecure({ NODE_ENV: "production" })).toBe(true);
    expect(cookieSecure({ NODE_ENV: "production", COOKIE_SECURE: "0" })).toBe(false);
    expect(cookieSecure({})).toBe(false);
  });

  it("TRUST_PROXY is off unless set; counts hops", () => {
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ TRUST_PROXY: "false" })).toBe(0);
    expect(trustedProxyHops({ TRUST_PROXY: "true" })).toBe(1);
    expect(trustedProxyHops({ TRUST_PROXY: "2" })).toBe(2);
    expect(trustedProxyHops({ TRUST_PROXY: "999" })).toBe(0);
    expect(trustedProxyHops({ TRUST_PROXY: "weird" })).toBe(0);
  });

  it("bcrypt cost is 12 unless configured within bounds", () => {
    expect(bcryptCost({})).toBe(12);
    expect(bcryptCost({ BCRYPT_COST: "4" })).toBe(4);
    expect(() => bcryptCost({ BCRYPT_COST: "3" })).toThrow();
    expect(() => bcryptCost({ BCRYPT_COST: "x" })).toThrow();
  });
});
