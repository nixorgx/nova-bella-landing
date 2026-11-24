import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce, HSTS_MAX_AGE_SECONDS, strictTransportSecurity } from "@/lib/security/csp";

const prod = buildCsp({ nonce: "abc123", isDev: false, upgradeInsecure: true });
const dev = buildCsp({ nonce: "abc123", isDev: true, upgradeInsecure: false });

describe("buildCsp", () => {
  it("allows scripts only by nonce (no unsafe-inline / unsafe-eval in production)", () => {
    expect(prod).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-eval");
    const scriptSrc = prod.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(prod).toContain("style-src 'self' 'nonce-abc123'");
  });

  it("locks down framing, plugins, base URI and form targets", () => {
    for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"]) {
      expect(prod).toContain(directive);
    }
  });

  it("only talks to its own origin", () => {
    expect(prod).toContain("connect-src 'self'");
    expect(prod).not.toMatch(/https?:\/\/(?!\S*nonce)/);
  });

  it("keeps the camera scanner (blob media/workers) and QR/barcode images (data:/blob:) working", () => {
    expect(prod).toContain("img-src 'self' blob: data:");
    expect(prod).toContain("media-src 'self' blob:");
  });

  it("relaxes only what Next dev needs", () => {
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("style-src 'self' 'unsafe-inline'");
    expect(dev).toContain("ws:");
  });

  it("upgrade-insecure-requests only when asked (HTTPS deployments)", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });
});

describe("generateNonce", () => {
  it("is unique per call and base64", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("strictTransportSecurity", () => {
  it("is production-only", () => {
    expect(strictTransportSecurity(false)).toBeNull();
    expect(strictTransportSecurity(true)).toBe(`max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`);
  });
});
