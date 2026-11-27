import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createWorstCase, type WorstCaseIds } from "./db";
import { ADMIN, horizontalOverflow, login, SELLER } from "./helpers";

const OUT = path.join(__dirname, "screenshots", "demo3");
const WIDTHS = [320, 768] as const;

async function check(page: Page, name: string, width: number): Promise<void> {
  await page.waitForLoadState("networkidle");
  expect(await horizontalOverflow(page), `${name} @${width} desborda horizontalmente`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
}

test.describe("demo 3: peor caso (nombres largos, montos grandes, motivos largos)", () => {
  test.setTimeout(240_000);
  let worst: WorstCaseIds;

  test.beforeAll(async () => {
    worst = await createWorstCase();
  });

  for (const width of WIDTHS) {
    test(`superadmin a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, ADMIN);
      const screens: readonly (readonly [string, string])[] = [
        ["50-peor-dashboard", "/dashboard"],
        ["51-peor-resumen", "/reportes?periodo=hoy"],
        ["52-peor-modelos", "/reportes?periodo=hoy&vista=modelos"],
        ["53-peor-stock", "/reportes?periodo=hoy&vista=stock"],
        ["54-peor-vendedores", "/reportes?periodo=hoy&vista=vendedores"],
        ["55-peor-cambios", "/reportes?periodo=hoy&vista=cambios"],
        ["56-peor-utilidad", "/reportes?periodo=hoy&vista=rentabilidad"],
        ["57-peor-cajas", "/cajas"],
        ["58-peor-venta", `/ventas/${worst.saleId}`],
        ["59-peor-venta-anulada", `/ventas/${worst.voidedId}`],
        ["60-peor-ticket-cambio", `/ventas/${worst.saleId}/ticket?cambio=${worst.groupId}`],
        ["61-peor-ticket", `/ventas/${worst.saleId}/ticket`],
      ];
      for (const [name, url] of screens) {
        await page.goto(url);
        await expect(page.locator("main h1, main .ticket").first()).toBeVisible();
        await check(page, name, width);
      }
    });

    test(`vendedor a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, SELLER);
      for (const [name, url] of [
        ["62-peor-mis-ventas", "/reportes?periodo=hoy"],
        ["63-peor-mis-modelos", "/reportes?periodo=hoy&vista=modelos"],
        ["64-peor-venta-vendedor", `/ventas/${worst.saleId}`],
        ["65-peor-historial", "/ventas/historial"],
      ] as const) {
        await page.goto(url);
        await expect(page.locator("main h1").first()).toBeVisible();
        await check(page, name, width);
      }
    });
  }
});
