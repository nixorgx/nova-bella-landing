import { expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { deriveOrderToken } from "../src/features/store/order-token";
import { ownerQuery } from "./db";

/** Token of a seeded demo order (the seed derives tokens from fixed idempotency keys). */
export const SEEDED = {
  pending: "seed-demo-pending-0001",
  review: "seed-demo-review-00002",
  confirmed: "seed-demo-confirm-0003",
  shipping: "seed-demo-shipping-004",
  ready: "seed-demo-ready-000005",
  delivered: "seed-demo-done-0000006",
  cancelled: "seed-demo-cancel-00007",
} as const;

export const seededToken = (key: string): string => deriveOrderToken(key, process.env.ORDER_TOKEN_SECRET as string);

export const randomPhone = (): string => `7${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

/** A real (noisy) PNG used as the buyer's "comprobante". */
export const proofPng = (): Promise<Buffer> =>
  sharp({ create: { width: 360, height: 480, channels: 3, background: "#fafafa", noise: { type: "gaussian", mean: 200, sigma: 40 } } }).png().toBuffer();

/** Adds the first purchasable size of a model to the cart (through the real UI) and returns to the cart page. */
/** On a product page: tries each color until one has a size in stock, then picks that size. */
export async function pickAvailableSize(page: Page): Promise<void> {
  const swatches = page.locator(".opt__swatch");
  const count = await swatches.count();
  for (let i = 0; i < Math.max(count, 1); i++) {
    if (count > 0) await swatches.nth(i).locator("input").check();
    const size = page.locator(".opt__size:not([data-unavailable]) input").first();
    if (await size.count()) {
      await size.check();
      return;
    }
  }
  throw new Error("Ningún color de este modelo tiene talla disponible");
}

export async function addToCart(page: Page, slug: string, opts: { color?: string } = {}): Promise<void> {
  await page.goto(`/tienda/${slug}`);
  if (opts.color) await page.locator(".opt__swatch", { hasText: opts.color }).locator("input").check();
  await pickAvailableSize(page);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByText("Agregado al carrito")).toBeVisible();
}

export async function fillCheckout(page: Page, phone: string, opts: { pickup?: boolean; cod?: boolean; invoice?: boolean } = {}): Promise<void> {
  await page.getByLabel("Nombre completo").fill("Compradora de Prueba");
  await page.getByLabel("Celular (WhatsApp)").fill(phone);
  if (opts.pickup) await page.getByLabel(/Recojo en tienda/).check();
  else {
    await page.getByLabel("Dirección", { exact: true }).fill("Calle de Prueba 456, Barrio Sirari");
    await page.getByLabel("Referencia (opcional)").fill("Portón azul");
  }
  if (opts.cod) await page.getByLabel(/Contra entrega/).check();
  if (opts.invoice) {
    await page.getByLabel("Quiero factura").check();
    await page.getByLabel("NIT o CI").fill("1234567011");
    await page.getByLabel("Razón social").fill("Compradora SRL");
  }
}

export async function orderByPhone(phone: string) {
  const rows = await ownerQuery<{ id: string; code: string; status: string; total: string; sale_id: string | null; proof_count: number; payment_method: string; fulfillment: string }>(
    "select id, code, status, total::text, sale_id, proof_count, payment_method, fulfillment from web_orders where phone = $1 order by created_at",
    [phone],
  );
  return rows;
}

export async function setStoreOpen(open: boolean): Promise<void> {
  await ownerQuery("update app_settings set value = $1 where key = 'store_open'", [String(open)]);
}

export interface PlacedOrder { readonly code: string; readonly token: string; readonly phone: string; readonly id: string }

/** Buyer side through the real UI: product -> cart -> checkout -> order page. */
export async function placeOrderViaUi(page: Page, slug: string, opts: { cod?: boolean; pickup?: boolean; qty?: number } = {}): Promise<PlacedOrder> {
  const phone = randomPhone();
  await page.context().clearCookies();
  await addToCart(page, slug);
  if ((opts.qty ?? 1) > 1) {
    await page.goto("/tienda/carrito");
    for (let i = 1; i < (opts.qty ?? 1); i++) await page.getByRole("button", { name: "Más" }).click();
  }
  await page.goto("/tienda/pedido");
  await fillCheckout(page, phone, { cod: opts.cod, pickup: opts.pickup });
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await page.waitForURL(/\/tienda\/pedido\/[A-Za-z0-9_-]{43}/);
  const token = /\/tienda\/pedido\/([A-Za-z0-9_-]{43})/.exec(page.url())![1];
  const code = (await page.locator(".order__code").textContent())!.trim();
  const [order] = await orderByPhone(phone);
  return { code, token, phone, id: order.id };
}
