import { expect, test } from "@playwright/test";
import { ownerQuery } from "./db";
import { ADMIN, login } from "./helpers";
import { addToCart, fillCheckout, orderByPhone, pickAvailableSize, proofPng, randomPhone } from "./store-helpers";

/** Buyer journeys on a phone (Pixel 7). They create real (clearly test) orders in the demo database. */
test.describe.configure({ mode: "serial" });

test("catalog: photos load, filters and search work, purchase info is at the END", async ({ page }) => {
  await page.goto("/tienda");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("carácter");
  const first = page.locator(".pcard img").first();
  await expect(first).toBeVisible();
  await expect.poll(() => first.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await first.getAttribute("width")).toBeTruthy(); // explicit dimensions: no layout shift

  // products first, "cómo comprar" last
  const cardsY = (await page.locator(".pgrid").boundingBox())!.y;
  const howtoY = (await page.locator("#como-comprar").boundingBox())!.y;
  expect(cardsY).toBeLessThan(howtoY);

  const total = await page.locator(".pcard").count();
  expect(total).toBeGreaterThanOrEqual(5);
  await page.getByText("Filtros y orden").click();
  await page.locator(".schip", { hasText: /^Dama$/ }).click();
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/linea=/);
  const names = await page.locator(".pcard__name").allTextContents();
  expect(names.sort()).toEqual(["Alba", "Illimani"]);

  await page.goto("/tienda?q=illimani");
  await expect(page.locator(".pcard")).toHaveCount(1);
  await page.goto("/tienda?orden=menor-precio&max=200");
  for (const price of await page.locator(".pcard__price").allTextContents()) expect(Number(price.replace(/[^\d,]/g, "").replace(",", ".")) ).toBeLessThanOrEqual(200);
  await page.goto("/tienda?q=zzzz-no-existe");
  await expect(page.getByText("Ningún modelo coincide")).toBeVisible();
});

test("product page: out-of-stock sizes are visible but disabled; only the last units show a number", async ({ page }) => {
  await page.goto("/tienda/alba");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Alba");
  await expect(page.locator(".opt__size")).toHaveCount(6);
  // somewhere across the colors there is a sold-out size (the seed leaves every 7th variant at zero): visible and disabled
  let disabledSeen = 0;
  for (let i = 0; i < (await page.locator(".opt__swatch").count()); i++) {
    await page.locator(".opt__swatch").nth(i).locator("input").check();
    const unavailable = page.locator('.opt__size[data-unavailable="true"] input');
    for (let j = 0; j < (await unavailable.count()); j++) {
      await expect(unavailable.nth(j)).toBeDisabled();
      await expect(page.locator('.opt__size[data-unavailable="true"]').nth(j)).toBeVisible();
      disabledSeen += 1;
    }
  }
  expect(disabledSeen).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByText("Elija una talla")).toBeVisible();
  await pickAvailableSize(page);
  await expect(page.locator(".pview__stock")).toContainText(/Disponible|Queda/);
  expect(await page.content()).not.toMatch(/cost|margen|utilidad/i);
});

test("full journey: browse -> product -> cart -> checkout (delivery + QR) -> proof -> status page", async ({ page }) => {
  const phone = randomPhone();
  await page.goto("/tienda");
  await page.locator(".pcard", { hasText: "Illimani" }).click();
  await expect(page).toHaveURL(/\/tienda\/illimani$/);
  await pickAvailableSize(page);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.getByRole("link", { name: "Ver carrito" }).click();
  await expect(page.getByRole("heading", { name: "Su carrito" })).toBeVisible();
  await expect(page.locator(".cline")).toHaveCount(1);
  await expect(page.locator(".scart__summary")).toContainText("329,00");
  await page.getByRole("link", { name: "Continuar con el pedido" }).click();

  await fillCheckout(page, phone);
  await expect(page.getByRole("button", { name: /Confirmar pedido · Bs 344,00/ })).toBeEnabled(); // 329 + 15 delivery
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await page.waitForURL(/\/tienda\/pedido\/[A-Za-z0-9_-]{43}/);
  const code = (await page.locator(".order__code").textContent())!.trim();
  expect(code).toMatch(/^NB-[A-Z2-9]{6}$/);
  await expect(page.locator(".sstatus")).toHaveText("Pendiente de pago");
  await expect(page.locator(".paybox__amount")).toHaveText("Bs 344,00");
  const qr = page.locator(".paybox__qr img");
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => window.localStorage.getItem("nb-cart-v1"))).toBe("[]");
  await expect(page.getByRole("link", { name: "Enviar por WhatsApp" })).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\d+\\?text=.*${code}`));

  const [order] = await orderByPhone(phone);
  expect(order).toMatchObject({ status: "pendiente_pago", total: "344.00", payment_method: "qr", sale_id: null });
  const stockBefore = await ownerQuery<{ n: number }>("select coalesce(sum(qty),0)::int as n from stock_levels", []);

  // proof of payment
  await page.locator("#proof").setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: await proofPng() });
  await page.locator("#reference").fill("TX-998877");
  await page.getByRole("button", { name: "Enviar comprobante" }).click();
  await expect(page.getByText("Recibimos su comprobante").first()).toBeVisible();
  await page.reload();
  await expect(page.locator(".sstatus")).toHaveText("Pago en revisión");
  const [after] = await orderByPhone(phone);
  expect(after).toMatchObject({ status: "pago_en_revision", proof_count: 1 });
  const proofs = await ownerQuery<{ n: number; head: string }>("select octet_length(bytes) as n, encode(substring(bytes from 1 for 4), 'escape') as head from web_order_proofs where order_id = $1", [order.id]);
  expect(proofs[0].head).toBe("RIFF"); // re-encoded to WebP by sharp, not the uploaded PNG
  // no stock moved: placing an order does not reserve nor sell
  const stockAfter = await ownerQuery<{ n: number }>("select coalesce(sum(qty),0)::int as n from stock_levels", []);
  expect(stockAfter[0].n).toBe(stockBefore[0].n);
});

test("pickup + cash on delivery variant: no QR panel, free shipping, invoice data stored", async ({ page }) => {
  const phone = randomPhone();
  await addToCart(page, "urbano");
  await page.goto("/tienda/pedido");
  await fillCheckout(page, phone, { pickup: true, cod: true, invoice: true });
  await expect(page.getByRole("button", { name: /Confirmar pedido · Bs 349,00/ })).toBeEnabled();
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await page.waitForURL(/\/tienda\/pedido\/[A-Za-z0-9_-]{43}/);
  await expect(page.locator(".sstatus")).toHaveText("Pendiente de pago");
  await expect(page.locator(".paybox")).toHaveCount(0);
  await expect(page.getByText("Contra entrega / en tienda")).toBeVisible();
  await expect(page.getByText("la emitimos manualmente")).toBeVisible();
  const [order] = await orderByPhone(phone);
  expect(order).toMatchObject({ payment_method: "contra_entrega", fulfillment: "pickup", total: "349.00" });
  const inv = await ownerQuery<{ invoice_status: string; invoice_nit: string }>("select invoice_status, invoice_nit from web_orders where id = $1", [order.id]);
  expect(inv[0]).toEqual({ invoice_status: "pending_manual", invoice_nit: "1234567011" });
});

test("the server decides prices: tampered localStorage cannot change what is charged", async ({ page }) => {
  const variant = (await ownerQuery<{ id: string }>("select v.id from variants v join models m on m.id = v.model_id join stock_levels s on s.variant_id = v.id where m.name = 'Wawa' and s.qty >= 3 limit 1"))[0].id;
  await page.goto("/tienda");
  await page.evaluate((id) => window.localStorage.setItem("nb-cart-v1", JSON.stringify([{ variantId: id, qty: 2, price: 1, unit_price: "0.01" }])), variant);
  await page.goto("/tienda/carrito");
  await expect(page.locator(".scart__summary")).toContainText("258,00"); // 2 x 129,00
  await page.evaluate((id) => window.localStorage.setItem("nb-cart-v1", JSON.stringify([{ variantId: id, qty: 999 }])), variant);
  await page.goto("/tienda/carrito");
  await expect(page.getByText("Su carrito está vacío")).toBeVisible(); // corrupt quantities are discarded
});

test("stock that vanishes after adding to the cart is caught in the cart and at checkout", async ({ page }) => {
  const [v] = await ownerQuery<{ id: string; qty: number; model: string }>(
    "select v.id, s.qty, m.name as model from variants v join models m on m.id = v.model_id join stock_levels s on s.variant_id = v.id where m.name = 'Colegial' and s.qty >= 2 limit 1",
  );
  await page.goto("/tienda");
  await page.evaluate((id) => window.localStorage.setItem("nb-cart-v1", JSON.stringify([{ variantId: id, qty: 2 }])), v.id);
  await page.goto("/tienda/carrito");
  await expect(page.locator(".cline")).toHaveCount(1);
  await ownerQuery("insert into stock_movements (variant_id, branch_id, qty, type, note) select $1, branch_id, -$2::int, 'adjust', 'e2e agotado' from stock_levels where variant_id = $1", [v.id, v.qty]);
  try {
    await page.goto("/tienda/carrito");
    await expect(page.getByText("Agotado por ahora")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ajustar mi carrito" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continuar con el pedido" })).toHaveCount(0);
    await page.goto("/tienda/pedido");
    await expect(page.getByRole("button", { name: /Confirmar pedido/ })).toBeDisabled();
  } finally {
    await ownerQuery("insert into stock_movements (variant_id, branch_id, qty, type, note) select $1, branch_id, $2::int, 'adjust', 'e2e restaurado' from stock_levels where variant_id = $1", [v.id, v.qty]);
  }
});

test("closed store (switched from the admin): catalog stays visible, checkout is disabled with a message", async ({ page, browser }) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, ADMIN);
  const toggle = async (open: boolean) => {
    await admin.goto("/tienda-online");
    const box = admin.locator(".switch input");
    if ((await box.isChecked()) !== open) await admin.locator(".switch").click();
    await admin.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(admin.getByText(/Ajustes guardados/)).toBeVisible();
  };
  await toggle(false);
  try {
    await addToCart(page, "alba");
    await page.goto("/tienda");
    await expect(page.getByText("La tienda está cerrada por ahora")).toBeVisible();
    await expect(page.locator(".pcard").first()).toBeVisible();
    await page.goto("/tienda/carrito");
    await expect(page.getByText("La tienda no recibe pedidos por ahora")).toBeVisible();
    await page.goto("/tienda/pedido");
    await expect(page.getByText("La tienda no está recibiendo pedidos en este momento")).toBeVisible();
    await expect(page.getByRole("button", { name: /Confirmar pedido/ })).toHaveCount(0);
  } finally {
    await toggle(true);
    await adminContext.close();
  }
  await page.goto("/tienda");
  await expect(page.getByText("La tienda está cerrada por ahora")).toHaveCount(0);
});

test("double click on 'Confirmar pedido' creates exactly one order", async ({ page }) => {
  const phone = randomPhone();
  await addToCart(page, "wawa");
  await page.goto("/tienda/pedido");
  await fillCheckout(page, phone);
  const button = page.getByRole("button", { name: /Confirmar pedido/ });
  await button.dblclick();
  await page.waitForURL(/\/tienda\/pedido\/[A-Za-z0-9_-]{43}/);
  expect(await orderByPhone(phone)).toHaveLength(1);
});
