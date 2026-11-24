import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { ownerQuery } from "./db";
import { ADMIN, COST_WORDS, login, SELLER, visibleMarkup } from "./helpers";
import { proofPng, placeOrderViaUi, SEEDED, seededToken } from "./store-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

async function openOrder(page: Page, code: string): Promise<void> {
  await page.goto(`/pedidos?q=${code}`);
  await page.getByRole("link", { name: code }).click();
  await expect(page.getByRole("heading", { level: 1, name: code })).toBeVisible();
}

const stockOfOrder = async (orderId: string) =>
  (await ownerQuery<{ qty: number }>(
    "select sl.qty from web_order_items i join stock_levels sl on sl.variant_id = i.variant_id join web_orders o on o.id = i.order_id and sl.branch_id = o.branch_id where i.order_id = $1",
    [orderId],
  ))[0].qty;

test("superadmin confirms a QR order: the sale enters the system with channel web and the stock goes down", async ({ page, browser }) => {
  const buyer = await browser.newContext();
  const order = await placeOrderViaUi(await buyer.newPage(), "alba");
  const before = await stockOfOrder(order.id);

  await login(page, ADMIN);
  await openOrder(page, order.code);
  await expect(page.getByText("Pendiente de pago").first()).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirmar pago y crear venta" });
  await confirm.dblclick(); // double click must not create two sales
  await expect(page.getByText("Pedido confirmado: la venta quedó registrada")).toBeVisible();

  const [row] = await ownerQuery<{ sale_id: string; status: string }>("select sale_id, status from web_orders where id = $1", [order.id]);
  expect(row.status).toBe("confirmado");
  const sales = await ownerQuery<{ channel: string; cash_session_id: string | null; total: string }>("select channel, cash_session_id, total::text from sales where id = $1", [row.sale_id]);
  expect(sales).toEqual([{ channel: "web", cash_session_id: null, total: "189.00" }]);
  expect(await ownerQuery("select 1 from sales where id = $1", [row.sale_id])).toHaveLength(1);
  expect(await stockOfOrder(order.id)).toBe(before - 1);

  // the sale is visible in Ventas with the Web badge, and reports can filter by channel
  await page.goto("/ventas/historial");
  await expect(page.locator("tr", { hasText: "Web" }).first()).toBeVisible();
  await page.goto("/reportes?periodo=mes&canal=web");
  await expect(page.getByLabel("Canal")).toHaveValue("web");
  const download = await page.request.get("/reportes/exportar/ventas?periodo=mes&canal=web");
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("spreadsheetml");

  // fulfilment steps, then the buyer sees the final state on the link
  await openOrder(page, order.code);
  await page.getByRole("button", { name: "Marcar en camino" }).click();
  await expect(page.getByText("Pedido marcado en camino.")).toBeVisible();
  await page.getByRole("button", { name: "Marcar como entregado" }).click();
  await expect(page.getByText("Pedido entregado.")).toBeVisible();
  const buyerPage = await buyer.newPage();
  await buyerPage.goto(`/tienda/pedido/${order.token}`);
  await expect(buyerPage.locator(".sstatus")).toHaveText("Entregado");
  await buyer.close();
});

test("reject a proof with a reason (the buyer sees it), then confirm", async ({ page, browser }) => {
  const buyer = await browser.newContext();
  const buyerPage = await buyer.newPage();
  const order = await placeOrderViaUi(buyerPage, "illimani");
  await buyerPage.locator("#proof").setInputFiles({ name: "c.png", mimeType: "image/png", buffer: await proofPng() });
  await buyerPage.getByRole("button", { name: "Enviar comprobante" }).click();
  await expect(buyerPage.getByText("Recibimos su comprobante").first()).toBeVisible();

  await login(page, ADMIN);
  await openOrder(page, order.code);
  await expect(page.getByText("Pago en revisión").first()).toBeVisible();
  const proof = page.locator(".proofs img").first();
  await expect(proof).toBeVisible();
  await expect.poll(() => proof.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.locator("summary", { hasText: "Rechazar comprobante" }).click();
  await page.getByLabel("Motivo (lo verá el cliente)").fill("El monto del comprobante no coincide");
  await page.getByRole("button", { name: /Confirmar: rechazar comprobante/i }).click();
  await expect(page.getByText("Comprobante rechazado: el cliente podrá enviar otro.")).toBeVisible();

  await buyerPage.goto(`/tienda/pedido/${order.token}`);
  await expect(buyerPage.getByText("El monto del comprobante no coincide")).toBeVisible();
  await expect(buyerPage.locator(".sstatus")).toHaveText("Pendiente de pago");

  await page.reload();
  await page.getByRole("button", { name: "Confirmar pago y crear venta" }).click();
  await expect(page.getByText("Pedido confirmado: la venta quedó registrada")).toBeVisible();
  await buyer.close();
});

test("cancelling a confirmed order voids its sale and returns the stock; cash on delivery records the real collection", async ({ page, browser }) => {
  const buyer = await browser.newContext();
  const order = await placeOrderViaUi(await buyer.newPage(), "wawa", { cod: true });
  const before = await stockOfOrder(order.id);
  await login(page, ADMIN);
  await openOrder(page, order.code);
  await page.getByRole("button", { name: "Confirmar pedido y crear venta" }).click();
  await expect(page.getByText("Pedido confirmado: la venta quedó registrada")).toBeVisible();
  expect(await stockOfOrder(order.id)).toBe(before - 1);
  await page.reload();
  await page.locator("summary", { hasText: "Cancelar pedido" }).click();
  await page.getByLabel("Motivo de la cancelación").fill("El cliente ya no lo quiere");
  await page.getByRole("button", { name: /Confirmar: cancelar pedido/i }).click();
  await expect(page.getByText("Pedido cancelado.")).toBeVisible();
  expect(await stockOfOrder(order.id)).toBe(before);
  const [row] = await ownerQuery<{ status: string; sale_status: string }>("select o.status, s.status as sale_status from web_orders o join sales s on s.id = o.sale_id where o.id = $1", [order.id]);
  expect(row).toEqual({ status: "cancelado", sale_status: "voided" });

  const cod = await placeOrderViaUi(await buyer.newPage(), "wawa", { cod: true, pickup: true });
  await openOrder(page, cod.code);
  await page.getByRole("button", { name: "Confirmar pedido y crear venta" }).click();
  await expect(page.getByText(/Pedido confirmado: la venta quedó registrada/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Marcar listo para recoger" }).click();
  await expect(page.getByText("Pedido listo para recoger.")).toBeVisible();
  await page.reload();
  await page.getByLabel("Cobrado al entregar").selectOption("qr");
  await page.getByRole("button", { name: "Marcar como entregado" }).click();
  await expect(page.getByText("Pedido entregado.")).toBeVisible();
  const [paid] = await ownerQuery<{ method: string }>("select p.method from sale_payments p join web_orders o on o.sale_id = p.sale_id where o.id = $1", [cod.id]);
  expect(paid.method).toBe("qr");
  await buyer.close();
});

test("seller: sees web orders of the branch without any cost, can dispatch but not confirm, cancel or see proofs or settings", async ({ page }) => {
  await login(page, SELLER);
  await page.goto("/pedidos");
  await expect(page.getByRole("heading", { level: 1, name: "Pedidos web" })).toBeVisible();
  expect(visibleMarkup(await page.content())).not.toMatch(COST_WORDS);

  const [confirmed] = await ownerQuery<{ id: string; code: string }>("select id, code from web_orders where status = 'confirmado' and branch_id = (select branch_id from users where username = 'vendedor1') order by created_at limit 1");
  await openOrder(page, confirmed.code);
  const markup = visibleMarkup(await page.content());
  expect(markup).not.toMatch(COST_WORDS);
  await expect(page.getByRole("button", { name: /Confirmar pago|Confirmar pedido|Rechazar|Cancelar pedido/ })).toHaveCount(0);
  await expect(page.getByText("Comprobantes")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Marcar (en camino|listo para recoger)/ })).toBeVisible();

  await page.goto("/tienda-online");
  await expect(page).toHaveURL(/\/ventas/);
  await page.goto("/catalogo");
  await expect(page).toHaveURL(/\/ventas/);
  const [proof] = await ownerQuery<{ order_id: string; id: string }>("select order_id, id from web_order_proofs limit 1");
  const response = await page.request.get(`/pedidos/${proof.order_id}/comprobante/${proof.id}`, { maxRedirects: 0 });
  expect(response.status()).toBe(403);
  expect([307, 403]).toContain((await page.request.get("/tienda-online/qr", { maxRedirects: 0 })).status());
  const sellerExport = await page.request.get("/reportes/exportar/ventas?periodo=mes");
  expect(sellerExport.status()).toBe(200);
});

test("anonymous visitors cannot reach any staff page or private image", async ({ request }) => {
  for (const path of ["/pedidos", "/tienda-online", "/pedidos/00000000-0000-4000-8000-000000000000", "/catalogo", "/reportes/exportar/ventas"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([302, 307, 308]).toContain(response.status());
    expect(response.headers().location).toContain("/login");
  }
  for (const path of ["/pedidos/00000000-0000-4000-8000-000000000000/comprobante/00000000-0000-4000-8000-000000000000", "/tienda-online/qr", "/tienda-online/foto/00000000-0000-4000-8000-000000000000"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([302, 307, 308, 403]).toContain(response.status());
  }
});

test("store settings: zones, policy text and the payment QR upload; model photos and publication", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/tienda-online");
  await expect(page.getByRole("heading", { level: 1, name: "Tienda online" })).toBeVisible();

  // policy text shows up in the public "Cómo comprar"
  const text = `Cambios dentro de 10 días (e2e ${Date.now()})`;
  await page.getByLabel("Política de cambios").fill(text);
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  await expect(page.getByText(/Ajustes guardados/)).toBeVisible();
  await page.goto("/tienda");
  await expect(page.getByText(text)).toBeVisible();

  // a new delivery zone appears at checkout
  await page.goto("/tienda-online");
  const zoneName = `Zona e2e ${Date.now().toString().slice(-5)}`;
  const newZone = page.locator("section", { has: page.getByRole("heading", { name: "Zonas de entrega" }) }).locator("form.zone-form").last();
  await newZone.getByLabel("Zona", { exact: true }).fill(zoneName);
  await newZone.getByLabel("Costo (Bs)").fill("22,50");
  await newZone.getByRole("button", { name: "Agregar zona" }).click();
  await expect(page.getByText(`Zona “${zoneName}” creada.`)).toBeVisible();
  const [zone] = await ownerQuery<{ fee: string }>("select fee::text from store_delivery_zones where name = $1", [zoneName]);
  expect(zone.fee).toBe("22.50");
  await ownerQuery("update store_delivery_zones set active = false where name = $1", [zoneName]);

  // QR: a PNG goes in, a lossless WebP comes out
  const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff", noise: { type: "gaussian", mean: 128, sigma: 50 } } }).png().toBuffer();
  await page.goto("/tienda-online");
  await page.locator("#up-qr").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: /Reemplazar QR|Subir QR/ }).click();
  await expect(page.getByText("QR de pago actualizado.")).toBeVisible();
  const [qr] = await ownerQuery<{ head: string }>("select encode(substring(bytes from 1 for 4), 'escape') as head from store_assets where key = 'payment_qr'");
  expect(qr.head).toBe("RIFF");
  // SVG is refused
  await page.locator("#up-qr").setInputFiles({ name: "qr.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><script>alert(1)</script><rect width="200" height="200"/></svg>') });
  await page.getByRole("button", { name: /Reemplazar QR|Subir QR/ }).click();
  await expect(page.getByText(/Solo se aceptan fotos JPG, PNG o WebP/)).toBeVisible();

  // model photo upload, make cover, delete
  await page.goto("/catalogo");
  await page.getByRole("link", { name: "Wawa", exact: true }).first().click();
  const [{ n: photosBefore }] = await ownerQuery<{ n: number }>("select count(*)::int as n from model_images where model_id = (select id from models where name = 'Wawa')");
  const photo = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#d98aa3", noise: { type: "gaussian", mean: 128, sigma: 70 } } }).jpeg().toBuffer();
  await page.locator("#up-photo").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: photo });
  await page.getByLabel("Descripción de la foto (opcional)").fill("Foto de prueba e2e");
  await page.getByRole("button", { name: "Subir foto" }).click();
  await expect(page.getByText("Foto agregada.")).toBeVisible();
  const [img] = await ownerQuery<{ full: number; thumb: number; w: number }>("select octet_length(full_bytes) as full, octet_length(thumb_bytes) as thumb, full_width as w from model_images where alt = 'Foto de prueba e2e'");
  expect(img.full).toBeLessThanOrEqual(150_000);
  expect(img.w).toBeLessThanOrEqual(900);
  await expect(page.locator(".photo")).toHaveCount(photosBefore + 1);
  await page.locator(".photo", { hasText: "Todos los colores" }).last().getByRole("button", { name: "Eliminar" }).click();
  await expect(page.locator(".photo")).toHaveCount(photosBefore); // the card disappears with its own message

  // unpublish / publish from the catalog table
  await page.goto("/catalogo");
  await page.getByLabel("Seleccionar Wawa para la tienda").check();
  await page.getByRole("button", { name: "Quitar seleccionados" }).click();
  await expect(page.getByText(/1 modelo quitados de la tienda|1 modelo.*quitados/)).toBeVisible();
  expect((await page.request.get("/tienda/wawa")).status()).toBe(404);
  await page.getByLabel("Seleccionar Wawa para la tienda").check();
  await page.getByRole("button", { name: "Publicar seleccionados" }).click();
  await expect(page.getByText(/1 modelo publicados/)).toBeVisible();
  expect((await page.request.get("/tienda/wawa")).status()).toBe(200);
});

test("pedidos list: status filters with counts, search, new-orders badge", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/pedidos");
  await expect(page.getByRole("navigation", { name: "Estados de pedidos" })).toBeVisible();
  await page.getByRole("link", { name: /^Cancelado/ }).click();
  await expect(page).toHaveURL(/estado=cancelado/);
  await expect(page.locator("tbody tr").first()).toContainText("Cancelado");
  await page.goto(`/pedidos?q=${encodeURIComponent("Rosa Vargas")}`);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(seededToken(SEEDED.review)).toHaveLength(43);
  await expect(page.locator(".nav .nav__badge")).toBeVisible();
});
