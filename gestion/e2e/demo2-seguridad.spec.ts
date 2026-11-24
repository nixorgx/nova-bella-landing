import { expect, test, type Page } from "@playwright/test";
import { ownerQuery } from "./db";
import { ADMIN, COST_WORDS, login, SELLER, visibleMarkup } from "./helpers";

const LEAKS = new RegExp(`${COST_WORDS.source}|permission denied|\\bat .*\\.(ts|js)x?:\\d+|select .* from`, "i");

async function expectClean(page: Page, path: string): Promise<void> {
  const raw = await page.request.get(path);
  expect(raw.status(), path).toBeLessThan(500);
  const body = visibleMarkup(await raw.text());
  expect(body.match(LEAKS)?.[0] ?? null, `HTML crudo de ${path}`).toBeNull();

  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const dom = visibleMarkup(await page.content());
  expect(dom.match(LEAKS)?.[0] ?? null, `DOM de ${path}`).toBeNull();
}

test.describe("demo 2: el vendedor nunca ve costos", () => {
  test("páginas, APIs y errores del vendedor no contienen datos de costo", async ({ page }) => {
    await login(page, SELLER);
    const [sale] = await ownerQuery<{ id: string }>("select id from sales order by created_at desc limit 1");
    const [customer] = await ownerQuery<{ id: string }>("select id from customers where branch_id is not null order by created_at desc limit 1");
    const [batch] = await ownerQuery<{ id: string }>("select id from purchase_batches limit 1");
    const [variant] = await ownerQuery<{ sku: string }>("select sku from variants order by sku limit 1");

    for (const path of [
      "/ventas", "/ventas/historial", "/ventas/caja", `/ventas/${sale.id}`, `/ventas/${sale.id}/ticket`,
      "/clientes", `/clientes/${customer.id}`, "/stock", "/stock?pagina=2",
    ]) {
      await expectClean(page, path);
    }

    // APIs and their error answers
    for (const path of [
      "/api/variantes/buscar?q=urbano", "/api/variantes/buscar?q=", "/api/variantes/buscar?q=%27%3B--",
      `/api/variantes/resolver?code=${variant.sku}`, "/api/variantes/resolver", "/api/clientes/buscar?q=ma",
      "/api/clientes/buscar", "/ventas/00000000-0000-4000-8000-000000000000", "/ventas/no-es-un-id", "/ruta-inexistente",
    ]) {
      const response = await page.request.get(path);
      const text = await response.text();
      expect(visibleMarkup(text).match(LEAKS)?.[0] ?? null, path).toBeNull();
    }

    // admin-only sections bounce the seller back to the POS
    for (const path of ["/compras", "/compras/nuevo", "/compras/precios", "/compras/tipos-de-cambio", `/compras/${batch.id}`, "/catalogo"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/ventas$/);
    }
    const nav = await page.getByRole("navigation", { name: "Principal" }).innerText();
    // "Reportes" is now open to sellers (their own sales only, see demo3-seguridad)
    expect(nav).not.toMatch(/Compras|Catálogo|Dashboard|Cajas|Usuarios/);
  });

  test("el superadmin sí ve costos (la regla es por rol, no por pantalla)", async ({ page }) => {
    await login(page, ADMIN);
    const [batch] = await ownerQuery<{ id: string }>("select id from purchase_batches limit 1");
    await page.goto(`/compras/${batch.id}`);
    await expect(page.getByText("Costo · solo superadmin")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tipos de cambio y flete del lote" })).toBeVisible();
  });

  test("los datos de costo no se pueden leer con el rol del vendedor ni siquiera por la base", async () => {
    // Owner-level sanity check of the grants the app relies on.
    const rows = await ownerQuery<{ granted: boolean }>(
      "select has_table_privilege('app_seller', 'variant_costs', 'select') as granted",
    );
    expect(rows[0].granted).toBe(false);
  });
});
