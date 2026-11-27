import { expect, type Page } from "@playwright/test";

/** Same variables the seed reads (playwright.config.ts loads .env.local). */
function seedPassword(name: "SEED_SUPERADMIN_PASSWORD" | "SEED_SELLER_PASSWORD"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}: defina las contrasenas del seed en .env.local antes de correr el e2e.`);
  return value;
}

/** Typed as written in SEED_SUPERADMIN_USERNAME (login ignores case; the stored username is lowercase). */
export const ADMIN = { username: process.env.SEED_SUPERADMIN_USERNAME?.trim() || "naty", password: seedPassword("SEED_SUPERADMIN_PASSWORD") };
export const SELLER = { username: "vendedor1", password: seedPassword("SEED_SELLER_PASSWORD") };

export async function login(page: Page, user: { username: string; password: string }): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(user.username);
  await page.getByLabel("Contraseña").fill(user.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Types a code the way a USB barcode reader does (fast keystrokes + Enter) into the search box. */
export async function scanCode(page: Page, code: string): Promise<void> {
  const box = page.getByRole("combobox", { name: /Escanear o buscar producto/ });
  await box.click();
  await box.pressSequentially(code, { delay: 4 });
  await box.press("Enter");
}

/** Strips what is allowed to look random (nonces, asset URLs) before scanning HTML for cost words. */
export function visibleMarkup(html: string): string {
  return html.replace(/\s(nonce|src|href|srcset|data-precedence)="[^"]*"/g, "");
}

export const COST_WORDS = /cost|landed|usd|margen|utilidad|purchase|exchange_rate/i;

/** Opens today's cash from the POS banner when the seller has none open. */
export async function ensureOpenCash(page: Page, opening = "200"): Promise<void> {
  await page.goto("/ventas");
  await page.waitForLoadState("networkidle");
  const banner = page.getByRole("heading", { name: /No hay una caja abierta/ });
  if (await banner.count()) {
    await page.getByLabel("Efectivo en caja al abrir (Bs)").fill(opening);
    await page.getByRole("button", { name: /Abrir caja de/ }).click();
    await expect(page.getByText(/Caja abierta/).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
  }
}

/** Scans one product into the POS cart, pays everything in cash and confirms. Returns the new sale id. */
export async function sellOnePair(page: Page, sku: string): Promise<string> {
  await ensureOpenCash(page);
  await scanCode(page, sku);
  await expect(page.getByTestId("pos-total")).not.toHaveText("Bs 0,00");
  await page.getByRole("button", { name: /Confirmar venta/ }).click();
  await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]{36}\/ticket\?nueva=1$/);
  return /ventas\/([0-9a-f-]{36})\/ticket/.exec(page.url())![1];
}
