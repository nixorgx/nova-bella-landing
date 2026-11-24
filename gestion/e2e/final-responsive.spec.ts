import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ownerQuery, stockedSku } from "./db";
import { ADMIN, ensureOpenCash, horizontalOverflow, login, scanCode, SELLER } from "./helpers";

/** Final delivery: key screens at every width, no horizontal overflow, saved to e2e/screenshots/final. */
const WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const;
const OUT = path.join(__dirname, "screenshots", "final");

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.waitForLoadState("networkidle");
  expect(await horizontalOverflow(page), `${name} @${width} desborda horizontalmente`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
}

for (const width of WIDTHS) {
  test.describe(`entrega final a ${width}px`, () => {
    test(`login y vendedor (POS con carrito, stock, reportes, historial, cajas)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await shoot(page, "01-login", width);

      await login(page, SELLER);
      await ensureOpenCash(page);
      const item = await stockedSku("Urbano", 2);
      await page.goto("/ventas");
      await page.waitForLoadState("networkidle");
      await scanCode(page, item.sku);
      await expect(page.getByTestId("pos-total")).not.toHaveText("Bs 0,00");
      await page.getByRole("button", { name: "+ Agregar otro pago" }).click();
      await shoot(page, "02-pos-carrito", width);

      for (const [file, route] of [
        ["03-vendedor-stock", "/stock"],
        ["04-vendedor-reportes", "/reportes?periodo=mes"],
        ["05-vendedor-historial", "/ventas/historial"],
        ["06-vendedor-caja", "/ventas/caja"],
      ] as const) {
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await shoot(page, file, width);
      }
    });

    test(`superadmin (dashboard, stock, reportes, cajas, sucursales, transferencias)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, ADMIN);
      await ownerQuery("update branches set active = true where name = 'La Paz'");
      try {
        for (const [file, route] of [
          ["10-admin-dashboard", "/dashboard"],
          ["11-admin-stock", "/stock"],
          ["12-admin-reportes", "/reportes?periodo=mes"],
          ["13-admin-cajas", "/cajas"],
          ["14-admin-sucursales", "/sucursales"],
          ["15-admin-transferencias", "/sucursales/transferencias"],
        ] as const) {
          await page.goto(route);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await shoot(page, file, width);
        }
        const item = await stockedSku("Colegial", 2);
        await page.goto("/sucursales/transferencias/nueva");
        await page.waitForLoadState("networkidle");
        await scanCode(page, item.sku);
        await expect(page.getByText(/Disponible en el origen/)).toBeVisible();
        await shoot(page, "16-admin-nueva-transferencia", width);
      } finally {
        await ownerQuery("update branches set active = false where name = 'La Paz'");
      }
    });
  });
}
