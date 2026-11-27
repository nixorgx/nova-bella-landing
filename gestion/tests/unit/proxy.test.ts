import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { encodeSession, SESSION_COOKIE } from "@/lib/auth/session";
import { proxy } from "@/proxy";

const UID = "11111111-1111-4111-8111-111111111111";

async function request(path: string, role?: "seller" | "superadmin") {
  const headers = new Headers();
  if (role) {
    const token = await encodeSession({ userId: UID, role, branchId: role === "seller" ? UID : null, tokenVersion: 0 });
    headers.set("cookie", `${SESSION_COOKIE}=${token}`);
  }
  return new NextRequest(`http://localhost:3000${path}`, { headers });
}

const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];

describe("proxy security headers", () => {
  it("adds a nonce CSP to pages it lets through, and forwards it to Next as a request header", async () => {
    const response = await proxy(await request("/login"));
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(csp));
  });

  it("uses a different nonce for every request", async () => {
    const [a, b] = await Promise.all([proxy(await request("/login")), proxy(await request("/login"))]);
    expect(nonceOf(a.headers.get("content-security-policy"))).not.toBe(nonceOf(b.headers.get("content-security-policy")));
  });

  it("also protects redirects (anonymous and wrong-role users)", async () => {
    const anonymous = await proxy(await request("/dashboard"));
    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get("location")).toContain("/login");
    expect(anonymous.headers.get("content-security-policy")).toContain("default-src 'self'");

    const seller = await proxy(await request("/usuarios", "seller"));
    expect(seller.headers.get("location")).toContain("/ventas");
    expect(seller.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("keeps serving allowed pages with the CSP attached", async () => {
    const response = await proxy(await request("/stock", "seller"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'");
  });

  it("lets anonymous visitors reach the public store (with its CSP) but nothing else", async () => {
    for (const path of ["/tienda", "/tienda/alba", "/tienda/pedido/abc", "/sitemap.xml", "/robots.txt"]) {
      const response = await proxy(await request(path));
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("content-security-policy"), path).toContain("'nonce-");
    }
    for (const path of ["/pedidos", "/tienda-online", "/catalogo", "/tiendax"]) {
      const response = await proxy(await request(path));
      expect(response.headers.get("location"), path).toContain("/login");
    }
  });

  it("keeps sellers out of the store settings but lets them see web orders", async () => {
    expect((await proxy(await request("/tienda-online", "seller"))).headers.get("location")).toContain("/ventas");
    expect((await proxy(await request("/pedidos", "seller"))).headers.get("location")).toBeNull();
    expect((await proxy(await request("/pedidos", "superadmin"))).headers.get("location")).toBeNull();
  });
});
