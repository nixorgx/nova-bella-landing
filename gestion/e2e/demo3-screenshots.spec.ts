import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ownerQuery, stockedSku } from "./db";
import { ADMIN, ensureOpenCash, horizontalOverflow, login, scanCode, SELLER } from "./helpers";

const WIDTHS = [320, 375, 768, 1024, 1440] as const;
const OUT = path.join(__dirname, "screenshots", "demo3");

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.waitForLoadState("networkidle");
  expect(await horizontalOverflow(page), `${name} @${width} desborda horizontalmente`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
}

interface Ids {
  readonly exchangedSale: string;
  readonly exchangeGroup: string;
  readonly voidedSale: string;
  readonly openSession: string;
  readonly closedSession: string;
  readonly plainSale: string;
}

async function loadIds(): Promise<Ids> {
  const [exchanged] = await ownerQuery<{ sale: string; grp: string }>(
    "select original_sale_id as sale, coalesce(group_id, id) as grp from exchanges where price_diff <> 0 order by created_at desc limit 1",
  );
  const [voided] = await ownerQuery<{ id: string }>("select id from sales where status = 'voided' order by voided_at desc limit 1");
  const [open] = await ownerQuery<{ id: string }>("select id from cash_sessions where closed_at is null limit 1");
  const [closed] = await ownerQuery<{ id: string }>(
    `select cs.id from cash_sessions cs
      where cs.closed_at is not null and exists (select 1 from sales s where s.cash_session_id = cs.id and s.status = 'voided')
      order by cs.opened_at desc limit 1`,
  );
  const [plain] = await ownerQuery<{ id: string }>(
    `select s.id from sales s where s.status = 'completed' and not exists (select 1 from exchanges e where e.original_sale_id = s.id)
        and (select sum(qty) from sale_items i where i.sale_id = s.id) >= 1 order by s.created_at desc limit 1`,
  );
  return { exchangedSale: exchanged.sale, exchangeGroup: exchanged.grp, voidedSale: voided.id, openSession: open.id, closedSession: closed?.id ?? open.id, plainSale: plain.id };
}

test.describe("demo 3: capturas responsive", () => {
  test.setTimeout(240_000);
  let ids: Ids;
  let twoPairSale = "";

  test.beforeAll(async () => {
    ids = await loadIds();
  });

  test("prepara una venta de dos pares para mostrar el cambio en curso", async ({ page }) => {
    const urbano = await stockedSku("Urbano", 4);
    await login(page, SELLER);
    await ensureOpenCash(page);
    await scanCode(page, urbano.sku);
    await scanCode(page, urbano.sku);
    await expect(page.getByLabel(new RegExp(`Cantidad de Urbano`)).last()).toHaveValue("2");
    await page.getByRole("button", { name: /Confirmar venta/ }).click();
    await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]{36}\/ticket\?nueva=1$/);
    twoPairSale = /ventas\/([0-9a-f-]{36})\/ticket/.exec(page.url())![1];
  });

  for (const width of WIDTHS) {
    test(`superadmin: dashboard, reportes y cajas a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, ADMIN);

      const screens: readonly (readonly [string, string])[] = [
        ["20-dashboard", "/dashboard"],
        ["21-reportes-resumen", "/reportes?periodo=mes"],
        ["22-reportes-modelos-tallas", "/reportes?periodo=mes&vista=modelos"],
        ["23-reportes-stock", "/reportes?vista=stock"],
        ["24-reportes-vendedores", "/reportes?periodo=mes&vista=vendedores"],
        ["25-reportes-cambios-anulaciones", "/reportes?periodo=mes&vista=cambios"],
        ["26-reportes-costo-utilidad", "/reportes?periodo=mes&vista=rentabilidad"],
        ["27-reportes-vacio", "/reportes?periodo=rango&desde=2020-01-01&hasta=2020-01-31"],
        ["28-cajas", "/cajas"],
        ["29-caja-detalle", `/cajas/${ids.closedSession}`],
        ["30-caja-abierta-detalle", `/cajas/${ids.openSession}`],
        ["31-venta-con-cambio", `/ventas/${ids.exchangedSale}`],
        ["32-venta-anulada", `/ventas/${ids.voidedSale}`],
        ["33-ticket-cambio", `/ventas/${ids.exchangedSale}/ticket?cambio=${ids.exchangeGroup}`],
        ["34-ticket-venta-con-cambio", `/ventas/${ids.exchangedSale}/ticket`],
      ];
      for (const [name, url] of screens) {
        await page.goto(url);
        await expect(page.locator("main h1, main .ticket").first()).toBeVisible();
        await shoot(page, name, width);
      }

      await page.goto(`/ventas/${ids.plainSale}`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Anular esta venta" }).click();
      await page.getByLabel("Motivo de la anulación").fill("Se cobró dos veces");
      await shoot(page, "35-anular-venta", width);
    });

    test(`vendedor: mis ventas y cambio en curso a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, SELLER);
      await page.goto("/reportes?periodo=mes");
      await expect(page.getByRole("heading", { name: "Mis ventas", level: 1 })).toBeVisible();
      await shoot(page, "40-mis-ventas", width);
      await page.goto("/reportes?periodo=mes&vista=modelos");
      await expect(page.locator(".heat")).toBeVisible();
      await shoot(page, "41-mis-ventas-modelos", width);
      await page.goto("/ventas/caja");
      await expect(page.getByRole("heading", { name: /Mis últimos turnos/ })).toBeVisible();
      await shoot(page, "42-mi-caja-historial", width);

      const colegial = await stockedSku("Colegial", 3);
      await page.goto(`/ventas/${twoPairSale}`);
      await page.waitForLoadState("networkidle");
      await shoot(page, "43-venta-antes-del-cambio", width);
      await page.getByRole("button", { name: "Registrar un cambio" }).click();
      await page.getByRole("checkbox", { name: /Urbano/ }).check();
      const search = page.getByRole("combobox", { name: /Cambiar Urbano/ });
      await search.fill(colegial.sku);
      await expect(page.getByRole("listbox", { name: "Resultados" }).getByRole("option").first()).toBeVisible();
      await search.press("Enter");
      await expect(page.locator(".xnet")).toBeVisible();
      await page.getByLabel("Motivo del cambio").selectOption("regalo");
      await shoot(page, "44-cambio-en-curso", width);
    });
  }
});
