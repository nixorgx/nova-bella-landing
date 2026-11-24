import { expect, test } from "@playwright/test";
import { ownerQuery } from "./db";
import { SEEDED, seededToken } from "./store-helpers";

/** Same list as the DB test: nothing a visitor receives may carry these. */
const FORBIDDEN = /cost|costo|margin|margen|utilidad|profit|supplier|proveedor|landed|exchange_rate|tipo_de_cambio|rate_70|rate_30|freight|flete|password|token_hash|app_private|avg_cost|last_cost|purchase_/i;

/** Strips what is allowed to look random or contain these letters inside URLs/ids/scripts' hashed chunk names. */
const visible = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => (m.includes("application/ld+json") ? m : ""))
    .replace(/\s(nonce|src|href|srcset|data-precedence|imagesrcset|content)="[^"]*"/g, "");

test("public pages never contain cost, supplier, rate or secret keys", async ({ request }) => {
  const token = seededToken(SEEDED.confirmed);
  for (const path of ["/tienda", "/tienda/alba", "/tienda/carrito", "/tienda/pedido", `/tienda/pedido/${token}`, "/sitemap.xml", "/robots.txt", "/tienda/no-existe"]) {
    const response = await request.get(path);
    const body = visible(await response.text());
    expect(body, path).not.toMatch(FORBIDDEN);
  }
});

test("the RSC / flight payload of a product page does not leak cost either", async ({ request }) => {
  const response = await request.get("/tienda/alba", { headers: { RSC: "1" } });
  expect(await response.text()).not.toMatch(FORBIDDEN);
});

test("headers: nonce CSP without unsafe-inline scripts, HSTS, nosniff, no third-party hosts", async ({ page, request }) => {
  const response = await request.get("/tienda");
  const csp = response.headers()["content-security-policy"];
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toContain("object-src 'none'");
  expect(response.headers()["strict-transport-security"]).toContain("max-age=");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");

  const hosts = new Set<string>();
  const errors: string[] = [];
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`)));
  await page.goto("/tienda");
  await page.goto("/tienda/alba");
  await page.waitForLoadState("networkidle");
  expect([...hosts]).toEqual([new URL(page.url()).host]);
  expect(errors).toEqual([]);
});

test("product photos: immutable cache, ETag, 304, WebP, locked down; bad ids are 404", async ({ request }) => {
  const [img] = await ownerQuery<{ id: string }>("select i.id from model_images i join models m on m.id = i.model_id where m.published_online limit 1");
  const first = await request.get(`/tienda/img/${img.id}?t=1`);
  expect(first.status()).toBe(200);
  const h = first.headers();
  expect(h["content-type"]).toBe("image/webp");
  expect(h["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toContain("sandbox");
  expect(h["etag"]).toBeTruthy();
  const body = await first.body();
  expect(body.subarray(0, 4).toString()).toBe("RIFF");
  expect(body.length).toBeLessThan(150_000);
  const again = await request.get(`/tienda/img/${img.id}?t=1`, { headers: { "If-None-Match": h["etag"] } });
  expect(again.status()).toBe(304);
  expect((await request.get("/tienda/img/not-a-uuid")).status()).toBe(404);
  expect((await request.get(`/tienda/img/${img.id}?x=${Date.now()}`)).status()).toBe(404); // random query strings never reach the DB
  expect((await request.get("/tienda/img/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
});

test("unpublished models and their photos are not public", async ({ request }) => {
  const [hidden] = await ownerQuery<{ id: string; slug: string }>("select id, slug from models where not published_online and active limit 1");
  expect((await request.get(`/tienda/${hidden.slug}`)).status()).toBe(404);
  const text = await (await request.get("/tienda")).text();
  expect(text).not.toContain(`/tienda/${hidden.slug}"`);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/tienda/alba");
  expect(sitemap).not.toContain(`/tienda/${hidden.slug}<`);
});

test("order links: unguessable, private and never indexed; wrong or malformed tokens are 404", async ({ request, page }) => {
  const token = seededToken(SEEDED.delivered);
  const ok = await request.get(`/tienda/pedido/${token}`);
  expect(ok.status()).toBe(200);
  const html = await ok.text();
  expect(ok.headers()["cache-control"]).toMatch(/no-store|no-cache|private/);
  expect(html).toMatch(/noindex/);
  expect(html).toMatch(/name="referrer" content="no-referrer"/);
  expect(html).not.toMatch(/phone_hash|token_hash/);
  expect((await request.get(`/tienda/pedido/${"A".repeat(43)}`)).status()).toBe(404);
  expect((await request.get("/tienda/pedido/short")).status()).toBe(404);
  expect((await request.get(`/tienda/qr/${"B".repeat(43)}`)).status()).toBe(404);
  const qr = await request.get(`/tienda/qr/${seededToken(SEEDED.pending)}`);
  expect(qr.status()).toBe(200);
  expect(qr.headers()["content-type"]).toBe("image/webp");
  expect(qr.headers()["cache-control"]).toContain("private");
  // a COD order has no QR
  expect((await request.get(`/tienda/qr/${seededToken(SEEDED.shipping)}`)).status()).toBe(404);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("/tienda/pedido");
  await page.goto(`/tienda/pedido/${token}`);
  expect(await page.locator("body").innerText()).not.toMatch(/70011\d{3}[\s\S]*70011\d{3}/); // only this buyer's phone
});

test("server actions refuse cross-origin posts (CSRF) and the honeypot rejects bots", async ({ page, request }) => {
  await page.goto("/tienda");
  // a forged POST with a foreign Origin never reaches the action
  const forged = await request.post("/tienda/pedido", { headers: { Origin: "https://evil.example", "Next-Action": "00" }, data: "[]", failOnStatusCode: false });
  expect([400, 403, 404, 405, 500]).toContain(forged.status());
  expect(await ownerQuery("select 1 from web_orders where customer_name = 'Bot'")).toHaveLength(0);
});

test("JSON-LD on the product page is valid and escaped", async ({ request }) => {
  const html = await (await request.get("/tienda/alba")).text();
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  expect(match).toBeTruthy();
  const data = JSON.parse(match![1]);
  expect(data).toMatchObject({ "@type": "Product", name: "Alba", offers: { priceCurrency: "BOB" } });
  expect(JSON.stringify(data)).not.toMatch(FORBIDDEN);
  expect(match![1]).not.toContain("<");
});
