import { expect, test } from "@playwright/test";
import { SELLER } from "./helpers";

test("login and app shell have no horizontal overflow on phones", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByLabel("Usuario").fill("vendedor1");
  await page.getByLabel("Contraseña").fill(SELLER.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/ventas$/);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("POS, history and cash screens have no horizontal overflow on phones", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill("vendedor1");
  await page.getByLabel("Contraseña").fill(SELLER.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/ventas$/);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const path of ["/ventas", "/ventas/historial", "/ventas/caja", "/clientes", "/stock"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await overflow(), path).toBeLessThanOrEqual(0);
  }
});
