import { expect, test } from "@playwright/test";
import { calculateBatchCosts } from "../src/lib/costing";
import { formatBs } from "../src/lib/money";
import { modelPrice, skuOf, stockedSku, stockOfSku } from "./db";
import { ADMIN, login, scanCode, SELLER } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("demo 2: compras (superadmin)", () => {
  test("registra un tipo de cambio, ingresa un lote por búsqueda y escaneo, y el stock sube", async ({ page }) => {
    const parallel = `10,${(Date.now() % 9) + 1}${(Date.now() % 8) + 1}`; // no trailing zero: the UI trims it
    await login(page, ADMIN);

    // --- exchange rates with history
    await page.goto("/compras/tipos-de-cambio");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("TC oficial").fill("6,96");
    await page.getByLabel("TC paralelo").fill(parallel);
    await page.getByRole("button", { name: "Registrar tipo de cambio" }).click();
    await expect(page.getByText("Tipo de cambio registrado.")).toBeVisible();
    await expect(page.locator("tbody tr").first()).toContainText("Último");
    await expect(page.locator("tbody tr").first()).toContainText(parallel);

    // --- new batch: "usar último TC", search + scan, live preview
    const alba = await skuOf("Alba", "Negro", "38");
    const colegial = await skuOf("Colegial", "Negro", "33");
    const before = { alba: await stockOfSku(alba), colegial: await stockOfSku(colegial) };

    await page.goto("/compras/nuevo");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Usar último TC" }).click();
    await expect(page.getByLabel("TC para la parte 70%")).toHaveValue("6,96");
    await expect(page.getByLabel("TC para la parte 30%")).toHaveValue(parallel);
    await page.getByLabel("Proveedor").fill("Proveedor E2E");
    await page.getByLabel("Flete total (Bs)").fill("100");

    const search = page.getByRole("combobox", { name: /Escanear o buscar producto/ });
    await search.fill("alba negro 38");
    await expect(page.getByRole("listbox", { name: "Resultados" }).getByRole("option").first()).toContainText("Alba");
    await search.press("Enter");
    await page.getByLabel("Cantidad de Alba Negro talla 38").fill("5");
    await page.getByLabel("Costo unitario en USD de Alba Negro talla 38").fill("14,50");

    await scanCode(page, colegial);
    await page.getByLabel("Cantidad de Colegial Negro talla 33").fill("3");
    await page.getByLabel("Costo unitario en USD de Colegial Negro talla 33").fill("11");

    const expected = calculateBatchCosts({
      rate70: "6.96",
      rate30: parallel.replace(",", "."),
      splitPct: "70",
      freightBs: "100",
      items: [
        { variantId: "a", qty: 5, unitCostUsd: "14.50" },
        { variantId: "b", qty: 3, unitCostUsd: "11.00" },
      ],
    });
    await expect(page.getByTestId("batch-total")).toHaveText(formatBs(expected.totalBs.toFixed(2)));
    await expect(page.getByText(formatBs(expected.items[0].unitCostBsLanded.toFixed(2))).first()).toBeVisible();

    await page.getByRole("button", { name: "Confirmar ingreso de mercadería" }).click();
    await expect(page).toHaveURL(/\/compras\/[0-9a-f-]{36}\?nuevo=1$/);
    await expect(page.getByRole("heading", { name: "Lote registrado: el stock ya subió" })).toBeVisible();
    await expect(page.getByText("Proveedor: Proveedor E2E")).toBeVisible();

    expect(await stockOfSku(alba)).toBe(before.alba + 5);
    expect(await stockOfSku(colegial)).toBe(before.colegial + 3);

    // --- list with filters
    await page.goto("/compras?proveedor=proveedor%20e2e");
    await expect(page.locator("tbody tr").first()).toContainText("Proveedor E2E");
  });

  test("las sugerencias de precio nunca se aplican solas y piden confirmación explícita", async ({ page }) => {
    await login(page, ADMIN);
    const before = await modelPrice("Alba");
    await page.goto("/compras/precios");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Precio sugerido por modelo" })).toBeVisible();
    expect(await modelPrice("Alba")).toBe(before);

    // margin policy is editable
    await expect(page.getByLabel("Margen objetivo (%)")).toHaveValue(/\d/);

    const apply = page.getByRole("button", { name: /^Aplicar Bs/ }).first();
    if (await apply.count()) {
      await apply.click();
      const confirmButton = page.getByRole("button", { name: "Aplicar nuevo precio" });
      await expect(confirmButton).toBeDisabled();
      await page.getByLabel("Confirmo el cambio de precio").check();
      await expect(confirmButton).toBeEnabled();
      await page.getByRole("button", { name: "Cancelar" }).click();
    }
    expect(await modelPrice("Alba")).toBe(before);
  });

  test("el stock del superadmin muestra la matriz con costo", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/stock");
    await expect(page.getByRole("heading", { name: "Alba", level: 2 })).toBeVisible();
    await expect(page.locator(".smatrix__cost").first()).toBeVisible();
    await expect(page.getByText("Valor a costo promedio")).toBeVisible();
  });
});

test.describe("demo 2: punto de venta (vendedor)", () => {
  test("abre caja, vende con pagos mixtos y descuento, imprime el ticket y aparece en el historial", async ({ page }) => {
    const urbano = await stockedSku("Urbano");
    const colegial = await stockedSku("Colegial");
    const customerName = `Cliente E2E ${Date.now().toString().slice(-6)}`;
    await login(page, SELLER);

    // --- cash: close the one left by the seed (shows expected vs counted), then open from the banner
    await page.goto("/ventas/caja");
    await page.waitForLoadState("networkidle");
    if (await page.getByRole("button", { name: "Cerrar caja" }).count()) {
      await page.getByLabel("Efectivo contado (Bs)").fill("100");
      await expect(page.getByText("Falta dinero en la caja.")).toBeVisible();
      await page.getByRole("button", { name: "Cerrar caja" }).click();
      await expect(page.getByText(/Caja cerrada\. Esperado/)).toBeVisible();
    }
    await page.goto("/ventas");
    await expect(page.getByRole("heading", { name: /No hay una caja abierta/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Efectivo en caja al abrir (Bs)").fill("200");
    await page.getByRole("button", { name: /Abrir caja de/ }).click();
    await expect(page.getByText(/Caja abierta/).first()).toBeVisible();

    // --- scan + keyboard-only cart
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("combobox", { name: /Escanear o buscar producto/ })).toBeFocused();
    await scanCode(page, urbano.sku);
    const urbanoLabel = `Urbano ${urbano.color} talla ${urbano.size}`;
    await expect(page.getByLabel(`Precio final de ${urbanoLabel}`)).toHaveValue("349.00");
    await scanCode(page, urbano.sku); // same shoe again: quantity +1
    await expect(page.getByLabel(`Cantidad de ${urbanoLabel}`).last()).toHaveValue("2");
    await scanCode(page, colegial.sku);
    await expect(page.getByTestId("pos-total")).toHaveText(formatBs("867.00"));

    // --- discount below the floor is refused with a clear hint; a valid one is accepted
    const price = page.getByLabel(`Precio final de ${urbanoLabel}`);
    await price.fill("200");
    await expect(page.getByText(/El precio mínimo es Bs 279,20/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Confirmar venta/ })).toBeDisabled();
    await price.fill("300");
    await expect(page.getByTestId("pos-total")).toHaveText(formatBs("769.00"));

    // --- customer quick-create, document type, mixed payments, change calculator
    await page.getByRole("button", { name: "Nuevo cliente" }).click();
    await page.getByLabel("Nombre").fill(customerName);
    await page.getByLabel("Teléfono").fill("71110000");
    await page.getByLabel("CI / NIT").fill("8765432");
    await page.getByRole("button", { name: "Guardar cliente" }).click();
    await expect(page.getByText(customerName)).toBeVisible();

    await page.getByText("Factura", { exact: true }).click();
    await page.getByLabel(/Monto del pago 1/).fill("500");
    await page.getByRole("button", { name: "+ Agregar otro pago" }).click();
    await page.getByRole("button", { name: /Completar el pago 2/ }).click();
    await expect(page.getByText("Pagos completos")).toBeVisible();
    await page.getByLabel("Efectivo recibido").fill("600");
    await expect(page.locator(".change-box output")).toHaveText(formatBs("100.00"));

    await page.getByRole("button", { name: /Confirmar venta/ }).click();
    await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]{36}\/ticket\?nueva=1$/);
    await expect(page.getByText(/registrada\. Entregue el ticket/)).toBeVisible();

    // --- ticket
    const ticket = page.locator(".ticket");
    await expect(ticket).toContainText("Factura N°");
    await expect(ticket).toContainText(customerName);
    await expect(ticket).toContainText("Descuento");
    await expect(ticket).toContainText("Efectivo");
    await expect(ticket).toContainText("QR");
    await expect(ticket).toContainText("TOTAL");
    await expect(ticket.getByText(formatBs("769.00"))).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".shell__rail")).toBeHidden();
    const pdf = await page.pdf({ preferCSSPageSize: true });
    const media = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString("latin1"));
    expect(Number(media?.[1])).toBeGreaterThan(226);
    expect(Number(media?.[1])).toBeLessThan(228); // 80 mm = 226.77 pt
    await page.emulateMedia({ media: "screen" });

    // --- history, detail, reprint
    await page.goto("/ventas/historial?documento=factura");
    const first = page.locator("tbody tr").first();
    await expect(first).toContainText(customerName);
    await expect(first).toContainText("Factura");
    await first.getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: /Venta N°/ })).toBeVisible();
    await expect(page.getByText("Precio lista").first()).toBeVisible();
    await page.getByRole("link", { name: "Ver ticket / Reimprimir" }).click();
    await expect(page.locator(".ticket")).toContainText(customerName);

    // --- customers CRUD page with purchase history
    await page.goto(`/clientes?q=${encodeURIComponent(customerName)}`);
    await page.getByRole("link", { name: customerName }).click();
    await expect(page.getByRole("heading", { name: "Historial de compras" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });

  test("el stock insuficiente se avisa con un mensaje claro", async ({ page }) => {
    await login(page, SELLER);
    await page.goto("/ventas");
    await page.waitForLoadState("networkidle");
    const one = await stockedSku("Wawa", 1);
    await scanCode(page, one.sku);
    const label = `Wawa ${one.color} talla ${one.size}`;
    const plus = page.getByRole("button", { name: `Agregar una unidad de ${label}` });
    const stock = Number((await page.locator(".stock-chip").first().textContent())?.replace(/\D/g, ""));
    for (let i = 1; i < stock; i += 1) await plus.click();
    await expect(plus).toBeDisabled();
    await scanCode(page, one.sku);
    await expect(page.getByText(new RegExp(`Solo hay ${stock} de Wawa`))).toBeVisible();
  });
});
