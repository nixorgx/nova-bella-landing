import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, login, SELLER } from "./helpers";
import { ownerQuery } from "./db";
import { addToCart, pickAvailableSize, SEEDED, seededToken } from "./store-helpers";

/** WCAG 2.2 A + AA on every new public and staff screen, at phone and desktop widths. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const found: string[] = [];

async function audit(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  // the sticky header would otherwise cover whatever scrolled under it and axe reads that as "obscured"
  await page.evaluate(() => window.scrollTo(0, 0));
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of violations) found.push(`${name}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test.afterEach(() => {
  const problems = found.splice(0);
  expect(problems, problems.join("\n")).toEqual([]);
});

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

for (const [label, width, height] of [["móvil 375", 375, 800], ["escritorio 1440", 1440, 900]] as const) {
  test(`tienda pública (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/tienda");
    await audit(page, `${label} home`);
    await page.getByText("Filtros y orden").click();
    await audit(page, `${label} filtros abiertos`);
    await page.goto("/tienda?q=zzzz");
    await audit(page, `${label} sin resultados`);
    await page.goto("/tienda?linea=00000000-0000-4000-8000-000000000000&orden=menor-precio");
    await audit(page, `${label} filtros inválidos`);
    await page.goto("/tienda/alba");
    await audit(page, `${label} producto`);
    await pickAvailableSize(page);
    await audit(page, `${label} producto con talla`);
    await page.goto("/tienda/carrito");
    await audit(page, `${label} carrito vacío`);
    await addToCart(page, "urbano");
    await page.goto("/tienda/carrito");
    await expect(page.locator(".cline")).toHaveCount(1);
    await audit(page, `${label} carrito`);
    await page.goto("/tienda/pedido");
    await expect(page.getByLabel("Nombre completo")).toBeVisible();
    await audit(page, `${label} checkout (domicilio, QR)`);
    await page.getByLabel(/Recojo en tienda/).check();
    await page.getByLabel(/Contra entrega/).check();
    await page.getByLabel("Quiero factura").check();
    await audit(page, `${label} checkout (recojo, contra entrega, factura)`);
    await page.getByRole("button", { name: /Confirmar pedido/ }).click();
    await expect(page.locator(".field__error").first()).toBeVisible();
    await audit(page, `${label} checkout con errores`);
    await page.goto("/tienda/no-existe-este-modelo");
    await audit(page, `${label} 404`);
  });

  test(`estado del pedido en cada estado (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const [state, key] of Object.entries(SEEDED)) {
      await page.goto(`/tienda/pedido/${seededToken(key)}`);
      await expect(page.locator(".order__code")).toBeVisible();
      await audit(page, `${label} pedido ${state}`);
    }
  });
}

test("staff: pedidos y tienda online (superadmin, escritorio y móvil)", async ({ page }) => {
  await login(page, ADMIN);
  const [order] = await ownerQuery<{ id: string }>("select id from web_orders where status = 'pago_en_revision' limit 1");
  const [shipped] = await ownerQuery<{ id: string }>("select id from web_orders where status = 'en_camino' limit 1");
  const [model] = await ownerQuery<{ id: string }>("select id from models where name = 'Alba'");
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/pedidos", "/pedidos?estado=cancelado", `/pedidos/${order.id}`, `/pedidos/${shipped.id}`, "/tienda-online", `/catalogo/modelos/${model.id}`, "/catalogo", "/reportes?periodo=mes&canal=web"]) {
      await page.goto(path);
      await audit(page, `superadmin ${width} ${path}`);
    }
    await page.goto(`/pedidos/${order.id}`);
    await page.locator("summary", { hasText: "Rechazar comprobante" }).click();
    await audit(page, `superadmin ${width} rechazar abierto`);
    await page.locator("summary", { hasText: "Cancelar pedido" }).click();
    await audit(page, `superadmin ${width} cancelar abierto`);
  }
});

test("staff: pedidos (vendedor)", async ({ page }) => {
  await login(page, SELLER);
  const [order] = await ownerQuery<{ id: string }>("select id from web_orders where status in ('confirmado','listo_para_recoger','en_camino') order by created_at limit 1");
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/pedidos", `/pedidos/${order.id}`]) {
      await page.goto(path);
      await audit(page, `vendedor ${width} ${path}`);
    }
  }
});
