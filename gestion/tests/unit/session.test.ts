import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  decodeSession,
  encodeSession,
  SESSION_AUDIENCE,
  SESSION_COOKIE,
  SESSION_ISSUER,
  sessionCookieOptions,
} from "@/lib/auth/session";

const payload = { userId: "11111111-1111-4111-8111-111111111111", role: "seller", branchId: "22222222-2222-4222-8222-222222222222", tokenVersion: 3 } as const;

describe("session tokens", () => {
  it("round-trips a payload", async () => {
    const token = await encodeSession(payload);
    expect(await decodeSession(token)).toEqual(payload);
  });

  it("supports superadmin without branch", async () => {
    const admin = { userId: payload.userId, role: "superadmin", branchId: null, tokenVersion: 0 } as const;
    expect(await decodeSession(await encodeSession(admin))).toEqual(admin);
  });

  it("rejects a tampered token", async () => {
    const token = await encodeSession(payload);
    const [header, body, signature] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, role: "superadmin" })).toString("base64url");
    expect(await decodeSession(`${header}.${forgedBody}.${signature}`)).toBeNull();
    expect(await decodeSession(`${header}.${body}.${signature.slice(0, -2)}xx`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await encodeSession(payload, { ttlSeconds: -60 });
    expect(await decodeSession(token)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const foreign = await new SignJWT({ role: "superadmin", branch: null, ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(payload.userId)
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("x".repeat(48)));
    expect(await decodeSession(foreign)).toBeNull();
  });

  it("rejects unsigned and malformed values", async () => {
    expect(await decodeSession(undefined)).toBeNull();
    expect(await decodeSession("")).toBeNull();
    expect(await decodeSession("not-a-jwt")).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: payload.userId, role: "superadmin" })).toString("base64url")}.`;
    expect(await decodeSession(none)).toBeNull();
  });

  it("rejects tokens with invalid claims", async () => {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const badRole = await new SignJWT({ role: "root", branch: null, ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(payload.userId)
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setExpirationTime("1h")
      .sign(secret);
    expect(await decodeSession(badRole)).toBeNull();
    const noSubject = await new SignJWT({ role: "seller", branch: null, ver: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setExpirationTime("1h")
      .sign(secret);
    expect(await decodeSession(noSubject)).toBeNull();
  });
});

describe("issuer, audience and token version", () => {
  const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET);
  const signed = (claims: Record<string, unknown>, issuer?: string, audience?: string) => {
    const jwt = new SignJWT({ role: "seller", branch: null, ver: 0, ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(payload.userId)
      .setExpirationTime("1h");
    if (issuer) jwt.setIssuer(issuer);
    if (audience) jwt.setAudience(audience);
    return jwt.sign(secret());
  };

  it("rejects tokens from another issuer or audience, or with none", async () => {
    expect(await decodeSession(await signed({}, "otra-app", SESSION_AUDIENCE))).toBeNull();
    expect(await decodeSession(await signed({}, SESSION_ISSUER, "otro-publico"))).toBeNull();
    expect(await decodeSession(await signed({}))).toBeNull();
    expect(await decodeSession(await signed({}, SESSION_ISSUER, SESSION_AUDIENCE))).not.toBeNull();
  });

  it("requires the token version claim and carries it through", async () => {
    expect(await decodeSession(await signed({ ver: undefined }, SESSION_ISSUER, SESSION_AUDIENCE))).toBeNull();
    expect(await decodeSession(await signed({ ver: -1 }, SESSION_ISSUER, SESSION_AUDIENCE))).toBeNull();
    const decoded = await decodeSession(await encodeSession(payload));
    expect(decoded?.tokenVersion).toBe(3);
  });
});

describe("cookie options", () => {
  it("are httpOnly, lax and path-wide", () => {
    const options = sessionCookieOptions(3600);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 3600 });
    expect(SESSION_COOKIE).toBe("inv_session");
  });

  it("is secure by default in production only", () => {
    expect(sessionCookieOptions(1, { NODE_ENV: "production" }).secure).toBe(true);
    expect(sessionCookieOptions(1, { NODE_ENV: "development" }).secure).toBe(false);
  });

  it("honours COOKIE_SECURE over NODE_ENV", () => {
    expect(sessionCookieOptions(1, { NODE_ENV: "production", COOKIE_SECURE: "false" }).secure).toBe(false);
    expect(sessionCookieOptions(1, { NODE_ENV: "development", COOKIE_SECURE: "true" }).secure).toBe(true);
    expect(sessionCookieOptions(1, { NODE_ENV: "production", COOKIE_SECURE: "banana" }).secure).toBe(true);
  });
});
