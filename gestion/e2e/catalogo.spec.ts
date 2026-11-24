import { expect, test } from "@playwright/test";
import { ADMIN, login, SELLER } from "./helpers";

test.describe("catálogo (superadmin)", () => {
  test("crea un modelo, genera variantes, busca y previsualiza etiquetas", async ({ page }) => {
    const modelName = `Prueba ${Date.now().toString().slice(-7)}`;
    await login(page, ADMIN);
    await page.goto("/catalogo");
    await expect(page.getByRole("heading", { name: "Catálogo", level: 1 })).toBeVisible();

    // --- create the model (first with an invalid price)
    await page.getByRole("link", { name: "Nuevo modelo" }).first().click();
    await expect(page.getByRole("heading", { name: "Nuevo modelo", level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle"); // let React hydrate before touching the form
    await page.getByRole("combobox", { name: "Línea" }).selectOption({ label: "Dama" });
    await page.getByRole("textbox", { name: "Nombre del modelo" }).fill(modelName);
    await page.getByRole("textbox", { name: "Precio base (Bs)" }).fill("abc");
    await page.getByRole("button", { name: "Crear modelo" }).click();
    await expect(page.getByText("Ingrese un precio válido en Bs")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Nombre del modelo" })).toHaveValue(modelName);
    await page.getByRole("textbox", { name: "Precio base (Bs)" }).fill("210,50");
    await page.getByRole("button", { name: "Crear modelo" }).click();
    await expect(page.getByRole("heading", { name: modelName, level: 1 })).toBeVisible();
    await expect(page.getByText("Este modelo aún no tiene variantes")).toBeVisible();

    // --- generate 2 colors x 2 sizes
    const tick = async (name: RegExp) => page.getByRole("checkbox", { name }).check();
    await tick(/Color Negro$/);
    await tick(/Color Rojo$/);
    await tick(/Talla 38$/);
    await tick(/Talla 39$/);
    await expect(page.getByText("4 variantes nuevas")).toBeVisible();
    await page.getByRole("button", { name: "Crear 4 variantes" }).click();
    await expect(page.getByText("Se crearon 4 variantes.")).toBeVisible();
    await expect(page.locator(".variants-table tbody tr")).toHaveCount(4);

    // --- generate again with overlap: only the missing one is created
    await tick(/Color Negro$/);
    await tick(/Talla 38$/);
    await tick(/Talla 39$/);
    await tick(/Talla 40$/);
    await expect(page.getByText("1 variante nueva · 2 ya existen y se omitirán")).toBeVisible();
    await page.getByRole("button", { name: "Crear 1 variante" }).click();
    await expect(page.getByText("Se creó 1 variante y se omitieron 2 que ya existían.")).toBeVisible();
    await expect(page.locator(".variants-table tbody tr")).toHaveCount(5);

    // --- barcodes: unique, with a clear duplicate error
    const skus = await page.locator(".variants-table .sku").allTextContents();
    const code = `775${Date.now().toString().slice(-9)}`;
    const first = page.getByLabel(`Código de barras de ${skus[0]}`);
    await first.fill(code);
    await page.locator(".variants-table tbody tr").nth(0).getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Código guardado.")).toBeVisible();
    const second = page.getByLabel(`Código de barras de ${skus[1]}`);
    await second.fill(code);
    await page.locator(".variants-table tbody tr").nth(1).getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(`Ese código de barras ya pertenece a ${skus[0]}.`)).toBeVisible();

    // --- search by model name with the keyboard, jump to the model
    await page.goto("/catalogo");
    const search = page.getByRole("combobox", { name: /Buscar o escanear/ });
    await search.fill(modelName.toLowerCase());
    await expect(page.getByRole("option").first()).toContainText(modelName);
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/catalogo\/modelos\/.+\?v=/);
    await expect(page.getByRole("heading", { name: modelName, level: 1 })).toBeVisible();

    // --- scanner-like input resolves a barcode
    await page.goto("/catalogo");
    await page.getByRole("combobox", { name: /Buscar o escanear/ }).fill(code);
    await expect(page.getByRole("option").first()).toContainText(skus[0]);

    // --- label preview and print layout
    await page.goto("/catalogo");
    await page.getByRole("link", { name: modelName }).click();
    await page.locator('a[href^="/catalogo/etiquetas?modelo="]').click();
    await expect(page.getByText("5 etiquetas · 5 páginas")).toBeVisible();
    const firstLabel = page.locator(".label").first();
    await expect(firstLabel.getByRole("img", { name: /QR de/ })).toBeVisible();
    await expect(firstLabel.getByRole("img", { name: /Código de barras de/ })).toBeVisible();
    await expect(firstLabel).toContainText(modelName);

    await page.getByRole("radio", { name: /Hoja A4/ }).check();
    await expect(page.getByText("5 etiquetas · 1 página · 21 por página")).toBeVisible();
    await page.getByRole("radio", { name: /50 × 30/ }).check();

    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ preferCSSPageSize: true });
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages).toHaveLength(5);
    await page.emulateMedia({ media: "screen" });
  });

  test("colores y tallas: crear, editar y desactivar", async ({ page }) => {
    const name = `Turquesa ${Date.now().toString().slice(-6)}`;
    await login(page, ADMIN);
    await page.goto("/catalogo/atributos");
    await page.getByLabel("Nuevo color").fill(name);
    await page.getByRole("button", { name: "Agregar color" }).click();
    await expect(page.getByText(`Color “${name}” creado.`)).toBeVisible();

    await page.getByLabel("Nuevo color").fill(name.toUpperCase());
    await page.getByRole("button", { name: "Agregar color" }).click();
    await expect(page.getByText("Ya existe un color con ese nombre.")).toBeVisible();

    const row = page.locator(".attr-row", { hasText: name });
    await row.getByRole("button", { name: /Editar/ }).click();
    await expect(row.getByRole("button", { name: "Eliminar" })).toBeVisible();
    await row.getByRole("button", { name: /Cerrar/ }).click();
    await row.getByRole("button", { name: `Desactivar el color ${name}` }).click();
    await expect(page.locator(".attr-row.is-off", { hasText: name })).toBeVisible();
  });
});

test.describe("catálogo (vendedor)", () => {
  test("no puede entrar al catálogo y la búsqueda no expone costos", async ({ page }) => {
    await login(page, SELLER);
    await page.goto("/catalogo");
    await expect(page).toHaveURL(/\/ventas$/);
    await page.goto("/catalogo/etiquetas");
    await expect(page).toHaveURL(/\/ventas$/);

    const response = await page.request.get("/api/variantes/buscar?q=alba");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.hits.length).toBeGreaterThan(0);
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/cost|landed|usd/);
    expect(Object.keys(body.hits[0])).toContain("stock");

    const anonymous = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
    const denied = await anonymous.request.get("/api/variantes/buscar?q=alba", { maxRedirects: 0 });
    expect([307, 308, 401]).toContain(denied.status());
    await anonymous.close();
  });
});
