import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ownerQuery, stockedSku } from "./db";
import { ADMIN, horizontalOverflow, login, scanCode, SELLER } from "./helpers";

const WIDTHS = [320, 375, 768, 1024, 1440] as const;
const OUT = path.join(__dirname, "screenshots", "demo2");

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.waitForLoadState("networkidle");
  expect(await horizontalOverflow(page), `${name} @${width} desborda horizontalmente`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
}

test.describe("demo 2: capturas responsive", () => {
  test.setTimeout(180_000);

  for (const width of WIDTHS) {
    test(`superadmin: compras y stock a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, ADMIN);

      await page.goto("/compras");
      await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
      await shoot(page, "01-compras-lotes", width);

      await page.goto("/compras/nuevo");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Usar último TC" }).click();
      await page.getByLabel("Flete total (Bs)").fill("120");
      const search = page.getByRole("combobox", { name: /Escanear o buscar producto/ });
      for (const [query, qty, cost] of [["alba negro 38", "6", "14,50"], ["urbano negro 41", "4", "24"]] as const) {
        await search.fill(query);
        await expect(page.getByRole("listbox", { name: "Resultados" }).getByRole("option").first()).toBeVisible();
        await search.press("Enter");
        const row = page.locator(".batch-item").last();
        await row.getByLabel(/^Cantidad de/).fill(qty);
        await row.getByLabel(/^Costo unitario/).fill(cost);
      }
      await expect(page.getByTestId("batch-total")).not.toHaveText("Bs 0,00");
      await shoot(page, "02-compras-nuevo-lote", width);

      await page.goto("/compras/tipos-de-cambio");
      await expect(page.getByRole("heading", { name: "Nuevo tipo de cambio" })).toBeVisible();
      await shoot(page, "03-tipos-de-cambio", width);

      await page.goto("/compras/precios");
      await expect(page.getByRole("heading", { name: "Políticas de precio" })).toBeVisible();
      await shoot(page, "04-precios-margen", width);

      const [batch] = await ownerQuery<{ id: string }>("select id from purchase_batches order by created_at desc limit 1");
      await page.goto(`/compras/${batch.id}`);
      await expect(page.getByRole("heading", { name: "Precios sugeridos con este lote" })).toBeVisible();
      await shoot(page, "05-detalle-lote", width);

      await page.goto("/stock");
      await expect(page.locator(".smatrix").first()).toBeVisible();
      await shoot(page, "06-stock-matriz", width);

      await page.goto("/ventas/historial");
      await expect(page.locator("tbody tr").first()).toBeVisible();
      await shoot(page, "07-historial-admin", width);
    });

    test(`vendedor: punto de venta, ticket y caja a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, SELLER);
      await page.goto("/ventas");
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("combobox", { name: /Escanear o buscar producto/ })).toBeVisible();
      await shoot(page, "10-pos-vacio", width);

      const urbano = await stockedSku("Urbano");
      const alba = await stockedSku("Alba");
      await scanCode(page, urbano.sku);
      await scanCode(page, alba.sku);
      await page.getByLabel(new RegExp(`^Precio final de Urbano`)).fill("300");
      await page.getByLabel(/Monto del pago 1/).fill("200");
      await page.getByRole("button", { name: "+ Agregar otro pago" }).click();
      await page.getByRole("button", { name: /Completar el pago 2/ }).click();
      await expect(page.getByText("Pagos completos")).toBeVisible();
      await shoot(page, "11-pos-venta-en-curso", width);

      await page.getByLabel(new RegExp(`^Precio final de Urbano`)).fill("100");
      await expect(page.getByText(/El precio mínimo es/)).toBeVisible();
      await shoot(page, "12-pos-descuento-bajo-el-minimo", width);

      const [sale] = await ownerQuery<{ id: string }>("select id from sales order by created_at desc limit 1");
      await page.goto(`/ventas/${sale.id}/ticket`);
      await expect(page.locator(".ticket")).toBeVisible();
      await shoot(page, "13-ticket", width);

      await page.goto(`/ventas/${sale.id}`);
      await expect(page.getByRole("heading", { name: /Venta N°/ })).toBeVisible();
      await shoot(page, "14-detalle-venta", width);

      await page.goto("/ventas/historial");
      await expect(page.locator("tbody tr").first()).toBeVisible();
      await shoot(page, "15-historial", width);

      await page.goto("/ventas/caja");
      await expect(page.getByRole("heading", { name: /Mis últimos turnos|Últimos turnos/ })).toBeVisible();
      await shoot(page, "16-caja", width);

      await page.goto("/clientes");
      await expect(page.getByRole("heading", { name: "Cartera de clientes" })).toBeVisible();
      await shoot(page, "17-clientes", width);
    });
  }

  for (const width of [320, 1440] as const) {
    test(`peor caso del POS (30 líneas, nombre larguísimo) a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, SELLER);
      await page.goto("/ventas");
      await page.waitForLoadState("networkidle");

      const skus = await ownerQuery<{ sku: string }>(
        `select v.sku from stock_levels sl join variants v on v.id = sl.variant_id
          where sl.qty >= 2 order by v.sku limit 30`,
      );
      // One scan at a time: wait for each line to land, otherwise a loaded machine can swallow a burst.
      for (const [index, { sku }] of skus.entries()) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          await scanCode(page, sku);
          const landed = await expect(page.locator(".cart-line")).toHaveCount(index + 1, { timeout: 2500 }).then(() => true, () => false);
          if (landed) break;
          if (attempt === 3) throw new Error(`El producto ${sku} no entró al carrito tras 3 escaneos`);
          await page.locator(".vsearch__input").fill("");
        }
      }
      await expect(page.locator(".cart-line")).toHaveCount(30);
      await expect(page.getByTestId("pos-total")).not.toHaveText("Bs 0,00");

      const longName = "María de los Ángeles Fernández-Villarroel de la Quintana y Echeverría Sánchez";
      await page.getByRole("button", { name: "Nuevo cliente" }).click();
      await page.getByLabel("Nombre").fill(longName);
      await page.getByRole("button", { name: "Guardar cliente" }).click();
      await expect(page.locator(".chosen")).toContainText("María de los Ángeles");
      await shoot(page, "20-pos-peor-caso", width);
    });
  }
});
