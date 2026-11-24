import ExcelJS from "exceljs";
import { expect, test, type APIResponse } from "@playwright/test";
import { formatBs } from "../src/lib/money";
import { openCashExpected, saleStatus, stockedSku, stockOfSku, todaySalesTotal } from "./db";
import { ADMIN, login, sellOnePair, SELLER } from "./helpers";

test.describe.configure({ mode: "serial" });

const state: { exchanged?: string; voided?: string; keepSku?: string; swapSku?: string } = {};

/** A formula cell reads back as {formula, result}; a zero result may be stored without a cached value. */
function resultOf(value: ExcelJS.CellValue): number {
  return typeof value === "object" && value !== null && "formula" in value ? Number(value.result ?? 0) : Number(value);
}

async function workbookOf(response: APIResponse): Promise<ExcelJS.Workbook> {
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("spreadsheetml");
  expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="[\w.-]+\.xlsx"/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await response.body()) as unknown as ArrayBuffer);
  return book;
}

test.describe("demo 3: cambios y anulaciones", () => {
  test("el vendedor cambia a otro modelo más caro, cobra la diferencia y el stock se mueve", async ({ page }) => {
    const colegial = await stockedSku("Colegial", 3);
    const urbano = await stockedSku("Urbano", 3);
    state.swapSku = urbano.sku;
    await login(page, SELLER);
    const saleId = await sellOnePair(page, colegial.sku);
    state.exchanged = saleId;
    const before = { returned: await stockOfSku(colegial.sku), replacement: await stockOfSku(urbano.sku) };
    const cashBefore = await openCashExpected();

    await page.goto(`/ventas/${saleId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Registrar un cambio" }).click();
    await page.getByRole("checkbox", { name: /Colegial/ }).check();
    const search = page.getByRole("combobox", { name: /Cambiar Colegial/ });
    await search.fill(urbano.sku);
    await expect(page.getByRole("listbox", { name: "Resultados" }).getByRole("option").first()).toContainText("Urbano");
    await search.press("Enter");

    // the difference is computed by the server: list price of the new pair - price paid
    await expect(page.getByText("Cobrar al cliente")).toBeVisible();
    await expect(page.locator(".xnet strong")).toHaveText(formatBs("180.00"));
    await expect(page.getByRole("button", { name: "Confirmar el cambio" })).toBeDisabled();
    await page.getByLabel("¿Cómo paga la diferencia?").selectOption("efectivo");
    await page.getByLabel("Motivo del cambio").selectOption("modelo");
    await page.getByRole("button", { name: "Confirmar el cambio" }).click();
    await expect(page.getByText(/Cambio registrado: el stock ya se movió/)).toBeVisible();

    expect(await stockOfSku(colegial.sku)).toBe(before.returned + 1);
    expect(await stockOfSku(urbano.sku)).toBe(before.replacement - 1);
    expect(await openCashExpected()).toBe((Number(cashBefore) + 180).toFixed(2));

    // history in the detail, then the exchange receipt
    await expect(page.getByRole("heading", { name: "Cambios de esta venta" })).toBeVisible();
    await expect(page.locator(".xhistory")).toContainText("Cambio de modelo");
    await expect(page.locator(".xhistory")).toContainText("Se cobró Bs 180,00");
    await page.getByRole("link", { name: "Ticket del cambio", exact: true }).click();
    const receipt = page.locator(".ticket");
    await expect(receipt).toContainText("Comprobante de cambio");
    await expect(receipt).toContainText("CAMBIO");
    await expect(receipt).toContainText("SE COBRA");
    await expect(receipt).toContainText("Efectivo");

    // the sale's own ticket shows the CAMBIO note too
    await page.goto(`/ventas/${saleId}/ticket`);
    await expect(page.locator(".ticket")).toContainText("CAMBIO REGISTRADO");
    await expect(page.locator(".ticket__exchanges")).toContainText("Urbano");
  });

  test("un producto ya cambiado por completo no se ofrece de nuevo y el vendedor no ve el botón de anular", async ({ page }) => {
    await login(page, SELLER);
    await page.goto(`/ventas/${state.exchanged}`);
    await page.waitForLoadState("networkidle");
    // the only pair of that sale was already exchanged
    await expect(page.getByText(/Todos los productos de esta venta ya se cambiaron/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular esta venta" })).toHaveCount(0);
  });

  test("el superadmin anula otra venta con motivo y ve la explicación en la que tiene cambios", async ({ page }) => {
    const wawa = await stockedSku("Wawa", 3);
    await login(page, SELLER);
    const saleId = await sellOnePair(page, wawa.sku);
    state.voided = saleId;
    const stockSold = await stockOfSku(wawa.sku);
    await page.context().clearCookies();

    await login(page, ADMIN);
    await page.goto(`/ventas/${saleId}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Anular esta venta" }).click();
    const confirm = page.getByRole("button", { name: "Confirmar anulación" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Motivo de la anulación").fill("Se cobró dos veces");
    await page.getByLabel(/Entiendo que esta acción/).check();
    await confirm.click();
    await expect(page.getByRole("heading", { name: "Venta anulada" })).toBeVisible();
    await expect(page.getByText("Se cobró dos veces").first()).toBeVisible();
    await expect(page.locator(".badge--void").first()).toBeVisible();
    expect(await saleStatus(saleId)).toEqual({ status: "voided", voidReason: "Se cobró dos veces" });
    expect(await stockOfSku(wawa.sku)).toBe(stockSold + 1);

    // listed in the history with its badge
    await page.goto("/ventas/historial");
    await expect(page.locator("tr", { hasText: "Anulada" }).first()).toBeVisible();

    // the sale that has an exchange cannot be voided: clear explanation + recommended path
    await page.goto(`/ventas/${state.exchanged}`);
    await expect(page.getByText(/tiene 1 cambio registrado y no se puede anular/)).toBeVisible();
    await expect(page.getByText(/Camino recomendado/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Anular esta venta" })).toHaveCount(0);
  });
});

test.describe("demo 3: reportes, excel y caja", () => {
  test("el reporte de hoy suma lo vendido sin las anuladas y refleja cambio y anulación", async ({ page }) => {
    await login(page, ADMIN);
    const today = await todaySalesTotal();
    await page.goto("/reportes?periodo=hoy");
    await expect(page.locator(".kpi--hero .kpi__value")).toHaveText(formatBs(today.total));
    await expect(page.locator(".kpi--hero")).toContainText(`${today.count} ${today.count === 1 ? "venta" : "ventas"}`);
    await expect(page.getByRole("heading", { name: "Cobrado por método de pago" })).toBeVisible();

    await page.goto("/reportes?periodo=hoy&vista=modelos");
    await expect(page.locator(".heat")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tallas más vendidas" })).toBeVisible();

    await page.goto("/reportes?periodo=hoy&vista=cambios");
    await expect(page.getByText("Cambio de modelo").first()).toBeVisible();
    await expect(page.getByText("Se cobró dos veces").first()).toBeVisible();

    await page.goto("/reportes?periodo=hoy&vista=rentabilidad");
    await expect(page.getByRole("heading", { name: "Utilidad por modelo" })).toBeVisible();
    await page.goto("/reportes?periodo=hoy&vista=stock");
    await expect(page.getByRole("heading", { name: "Stock bajo y agotado" })).toBeVisible();
    await page.goto("/reportes?periodo=hoy&vista=vendedores");
    await expect(page.getByRole("heading", { name: "Ventas por vendedor" })).toBeVisible();

    // shareable range via URL
    await page.goto("/reportes?periodo=rango&desde=2020-01-01&hasta=2020-01-31");
    await expect(page.getByText("Sin ventas en este período")).toBeVisible();
  });

  test("el Excel de ventas se descarga, se lee y cuadra con la base", async ({ page }) => {
    await login(page, ADMIN);
    const today = await todaySalesTotal();
    const book = await workbookOf(await page.request.get("/reportes/exportar/ventas?periodo=hoy"));
    expect(book.worksheets.map((s) => s.name)).toEqual(["Resumen", "Ventas", "Modelos", "Matriz", "Cambios", "Anulaciones"]);
    const sales = book.getWorksheet("Ventas")!;
    const total = sales.getRow(sales.rowCount).getCell("K").value as { formula: string; result: number };
    expect(total.formula).toContain("SUMIFS");
    expect(total.result).toBeCloseTo(Number(today.total), 2);
    expect(sales.getCell("K2").numFmt).toContain("Bs");
    expect(sales.getCell("B2").numFmt).toBe("dd/mm/yyyy hh:mm");
    expect(sales.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sales.autoFilter).toBeTruthy();
    const states = sales.getColumn("G").values.filter((v) => v === "Anulada");
    expect(states.length).toBeGreaterThanOrEqual(1);

    // sums by payment method (mixed payments): the four rows add up to the total collected
    const summary = book.getWorksheet("Resumen")!;
    const rows = new Map<string, ExcelJS.Row>();
    summary.eachRow((row) => rows.set(String(row.getCell(1).value), row));
    const methodSales = ["Efectivo", "QR", "Transferencia", "Tarjeta"].map((m) => resultOf(rows.get(m)!.getCell(2).value));
    expect(methodSales.reduce((a, b) => a + b, 0)).toBeCloseTo(Number(today.total), 2);

    const profit = await workbookOf(await page.request.get("/reportes/exportar/rentabilidad?periodo=hoy"));
    expect(profit.getWorksheet("Por modelo")).toBeTruthy();
    const stock = await workbookOf(await page.request.get("/reportes/exportar/stock"));
    expect(stock.getWorksheet("Costos")).toBeTruthy();
    const purchases = await workbookOf(await page.request.get("/reportes/exportar/compras?periodo=mes"));
    expect(purchases.getWorksheet("Compras")).toBeTruthy();
  });

  test("la caja del superadmin cuadra con el efectivo esperado y exporta a Excel", async ({ page }) => {
    await login(page, ADMIN);
    const expected = await openCashExpected();
    await page.goto("/cajas");
    const first = page.locator("tbody tr").first();
    await expect(first).toContainText("en curso");
    await expect(first).toContainText(formatBs(expected));
    await first.getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Caja abierta" })).toBeVisible();
    await expect(page.locator(".kpis")).toContainText(formatBs(expected));
    await expect(page.getByRole("heading", { name: "Cambios con diferencia de dinero" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ventas de esta caja" })).toBeVisible();

    const sessionId = /cajas\/([0-9a-f-]{36})/.exec(page.url())![1];
    const book = await workbookOf(await page.request.get(`/reportes/exportar/caja?sesion=${sessionId}`));
    const cajas = book.getWorksheet("Cajas")!;
    expect((cajas.getCell("K2").value as { result: number }).result).toBeCloseTo(Number(expected), 2);
    expect(book.getWorksheet("Ventas de la caja")).toBeTruthy();
    const list = await workbookOf(await page.request.get("/reportes/exportar/caja?periodo=mes"));
    expect(list.getWorksheet("Cajas")!.rowCount).toBeGreaterThan(3);
  });

  test("el vendedor ve solo sus ventas, sin costos, y su Excel no trae columnas de costo", async ({ page }) => {
    await login(page, SELLER);
    await page.goto("/reportes?periodo=hoy");
    await expect(page.getByRole("heading", { name: "Mis ventas", level: 1 })).toBeVisible();
    await expect(page.locator(".kpi--hero")).toBeVisible();
    await expect(page.getByRole("link", { name: "Costo y utilidad" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Stock", exact: true })).toHaveCount(1); // the main menu only

    const book = await workbookOf(await page.request.get("/reportes/exportar/ventas?periodo=hoy"));
    const headers: string[] = [];
    book.eachSheet((sheet) => sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value))));
    expect(headers.length).toBeGreaterThan(10);
    expect(headers.filter((h) => /cost|margen|utilidad|usd|proveedor/i.test(h))).toEqual([]);
    const stock = await workbookOf(await page.request.get("/reportes/exportar/stock"));
    expect(stock.worksheets.map((s) => s.name)).toEqual(["Resumen", "Stock"]);
  });
});
