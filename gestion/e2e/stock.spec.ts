import { expect, test } from "@playwright/test";
import { login, SELLER } from "./helpers";

test("stock is paginated and always shows the real total", async ({ page }) => {
  await login(page, SELLER);
  await page.goto("/stock?tamano=10");
  const status = page.getByRole("status").filter({ hasText: /Mostrando/ });
  await expect(status).toHaveText(/Mostrando 1–10 de \d+/);
  await expect(page.locator("tbody tr")).toHaveCount(10);
  const total = Number(/de (\d+)/.exec((await status.textContent()) ?? "")?.[1]);
  expect(total).toBeGreaterThan(10);

  await page.getByRole("link", { name: "Siguiente" }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await expect(page.getByRole("status").filter({ hasText: /Mostrando/ })).toHaveText(/Mostrando 11–/);
  await expect(page.getByRole("link", { name: "Anterior" })).toBeVisible();

  // a stale link past the end shows the last page instead of an empty table
  await page.goto("/stock?tamano=10&pagina=9999");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Mostrando/ })).toHaveText(new RegExp(`de ${total}$`));
});
