import { expect, test } from "@playwright/test";
import { ADMIN, horizontalOverflow, login } from "./helpers";

/** break-ui pass: unbreakable 60-char names, one-letter names and 30-char colors on a 320px phone. */
test("peores datos: nombres larguísimos y de una letra no rompen el diseño a 320px", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now().toString().slice(-5);
  const longModel = `Z${stamp}${"x".repeat(54)}`.slice(0, 60);
  const longColor = `Color${stamp}${"y".repeat(25)}`.slice(0, 30);
  await page.setViewportSize({ width: 320, height: 800 });
  await login(page, ADMIN);

  // a very long color
  await page.goto("/catalogo/atributos");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Nuevo color" }).fill(longColor);
  await page.getByRole("button", { name: "Agregar color" }).click();
  await expect(page.getByText("creado.").first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  for (const name of [longModel, "Q"]) {
    await page.goto("/catalogo/modelos/nuevo");
    await page.waitForLoadState("networkidle");
    await page.getByRole("combobox", { name: "Línea" }).selectOption({ label: "Niños" });
    await page.getByRole("textbox", { name: "Nombre del modelo" }).fill(name);
    await page.getByRole("textbox", { name: "Precio base (Bs)" }).fill("99999,99");
    await page.getByRole("button", { name: "Crear modelo" }).click();
    const created = page.getByRole("heading", { level: 1 }).filter({ hasText: name.slice(0, 10) });
    const duplicate = page.getByText("Ya existe un modelo con ese nombre");
    await expect(created.or(duplicate)).toBeVisible();
    if (await duplicate.isVisible()) {
      // one-letter model left over from a previous run: reuse it
      await page.goto(`/catalogo?q=${name}`);
      await page.getByRole("link", { name, exact: true }).click();
    }
    await expect(created).toBeVisible();
    await page.waitForLoadState("networkidle");

    await page.getByRole("checkbox", { name: new RegExp(`Color ${longColor}$`) }).check();
    await page.getByRole("checkbox", { name: /Color Negro$/ }).check();
    await page.getByRole("button", { name: "Todas las tallas" }).click();
    await page.getByRole("button", { name: /Crear \d+ variantes/ }).click();
    await expect(page.getByText(/Se crearon \d+ variantes/)).toBeVisible();
    expect(await horizontalOverflow(page), `modelo ${name}`).toBeLessThanOrEqual(0);

    const modelId = page.url().split("/modelos/")[1].split("?")[0];
    await page.goto(`/catalogo/etiquetas?modelo=${modelId}`);
    await expect(page.locator(".label").first()).toBeVisible();
    expect(await horizontalOverflow(page), `etiquetas ${name}`).toBeLessThanOrEqual(0);
  }

  await page.goto("/catalogo");
  await page.getByRole("searchbox", { name: "Nombre" }).fill("zzzz-no-existe");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByText("Ningún modelo coincide")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
