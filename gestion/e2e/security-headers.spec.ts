import { expect, test, type Page } from "@playwright/test";
import { ADMIN, login, SELLER } from "./helpers";

/** Collects CSP violations and console errors while the page runs. */
async function watch(page: Page): Promise<string[]> {
  const problems: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

test("responses carry a per-request nonce CSP, HSTS and the other security headers", async ({ request }) => {
  const first = await request.get("/login");
  const second = await request.get("/login");
  const csp = first.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const nonce = (value: string) => /'nonce-([^']+)'/.exec(value)?.[1];
  expect(nonce(csp)).toBeTruthy();
  expect(nonce(csp)).not.toBe(nonce(second.headers()["content-security-policy"]));
  expect(first.headers()["strict-transport-security"]).toContain("max-age=");
  expect(first.headers()["x-content-type-options"]).toBe("nosniff");
  // the same nonce reaches Next's own scripts in the HTML
  const html = await first.text();
  expect(html).toContain(`nonce="${nonce(csp)}"`);
});

test("superadmin pages render without CSP violations or console errors", async ({ page }) => {
  const problems = await watch(page);
  await login(page, ADMIN);
  for (const path of ["/dashboard", "/catalogo", "/catalogo/atributos", "/catalogo/etiquetas", "/usuarios", "/stock"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await violations(page), `CSP violations on ${path}`).toEqual([]);
  }
  expect(problems).toEqual([]);
});

test("seller pages render without CSP violations or console errors", async ({ page }) => {
  const problems = await watch(page);
  await login(page, SELLER);
  for (const path of ["/ventas", "/stock", "/clientes"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await violations(page), `CSP violations on ${path}`).toEqual([]);
  }
  expect(problems).toEqual([]);
});

test("a model page and the 404 page also render without CSP violations", async ({ page }) => {
  const problems = await watch(page);
  await login(page, ADMIN);
  await page.goto("/catalogo");
  await page.getByRole("link", { name: /Alba/ }).first().click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await violations(page), "CSP violations on the model page").toEqual([]);

  await page.goto("/esta-ruta-no-existe");
  await page.waitForLoadState("networkidle");
  expect(await violations(page), "CSP violations on the 404 page").toEqual([]);
  expect(problems.filter((p) => !p.includes("404"))).toEqual([]);
});

test("the login page itself is clean", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  expect(await violations(page)).toEqual([]);
  expect(problems).toEqual([]);
});
