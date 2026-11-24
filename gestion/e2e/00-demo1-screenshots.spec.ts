import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, horizontalOverflow, login } from "./helpers";

const WIDTHS = [320, 375, 768, 1024, 1440] as const;
const OUT = path.join(__dirname, "screenshots", "demo1");

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.waitForLoadState("networkidle");
  expect(await horizontalOverflow(page), `${name} @${width} overflows horizontally`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
}

test.describe("demo 1: capturas responsive", () => {
  test.setTimeout(120_000);

  for (const width of WIDTHS) {
    test(`catálogo a ${width}px sin desbordes`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, ADMIN);

      await page.goto("/catalogo");
      await expect(page.getByRole("heading", { name: "Modelos", level: 2 })).toBeVisible();
      await shoot(page, "01-resumen", width);

      await page.getByRole("link", { name: "Alba" }).first().click();
      await expect(page.getByRole("heading", { name: "Alba", level: 1 })).toBeVisible();
      await page.getByRole("checkbox", { name: /Color Miel$/ }).check();
      await page.getByRole("checkbox", { name: /Talla 41$/ }).check();
      await shoot(page, "02-modelo-generador", width);

      await page.goto("/catalogo/atributos");
      await expect(page.getByRole("heading", { name: "Tallas", level: 2 })).toBeVisible();
      await shoot(page, "03-atributos", width);

      await page.goto("/catalogo");
      await page.getByRole("link", { name: "Alba" }).first().click();
      await page.locator('a[href^="/catalogo/etiquetas?modelo="]').click();
      await expect(page.locator(".label").first()).toBeVisible();
      await shoot(page, "04-etiquetas", width);

      await page.goto("/catalogo");
      await page.getByRole("combobox", { name: /Buscar o escanear/ }).fill("negro 38");
      await expect(page.getByRole("option").first()).toBeVisible();
      await shoot(page, "05-busqueda", width);
    });
  }
});
