import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { formatBs } from "../src/lib/money";
import { ownerQuery, saleStatus, stockedSku, stockOfSku, todaySalesTotal } from "./db";
import { ADMIN, ensureOpenCash, login, scanCode, SELLER } from "./helpers";

/**
 * The whole critical journey in ONE spec, in the order a shop lives it:
 * login by role -> purchase batch -> sale with mixed payments -> exchange -> void -> report
 * -> Excel -> branch transfer, plus a keyboard-only sale. Each step checks the database too.
 */
test.describe.configure({ mode: "serial" });

const state: { sale?: string; voided?: string; sku?: string } = {};

async function logout(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function stockIn(sku: string, branch: string): Promise<number> {
  const rows = await ownerQuery<{ qty: number }>(
    `select coalesce(sum(sl.qty), 0)::int as qty from variants v
       join stock_levels sl on sl.variant_id = v.id join branches b on b.id = sl.branch_id
      where v.sku = $1 and b.name = $2`,
    [sku, branch],
  );
  return rows[0].qty;
}

test("1. cada rol aterriza en su pantalla y el vendedor no entra a las de superadmin", async ({ page }) => {
  await login(page, ADMIN);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hola");
  await logout(page);

  await login(page, SELLER);
  await expect(page).toHaveURL(/\/ventas$/);
  for (const forbidden of ["/dashboard", "/compras", "/sucursales", "/sucursales/transferencias/nueva", "/cajas", "/usuarios"]) {
    await page.goto(forbidden);
    await expect(page, forbidden).toHaveURL(/\/ventas$/);
  }
  await logout(page);
});

test("2. ingreso de lote por escaneo: el stock sube y el costo queda guardado", async ({ page }) => {
  const item = await stockedSku("Urbano", 3);
  state.sku = item.sku;
  const before = await stockOfSku(item.sku);
  await login(page, ADMIN);
  await page.goto("/compras/nuevo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("TC para la parte 70%").fill("6,96");
  await page.getByLabel("TC para la parte 30%").fill("10,50");
  await page.getByLabel("Proveedor").fill("Proveedor viaje E2E");
  await scanCode(page, item.sku);
  const label = `Urbano ${item.color} talla ${item.size}`;
  await page.getByLabel(`Cantidad de ${label}`).fill("4");
  await page.getByLabel(`Costo unitario en USD de ${label}`).fill("24");
  await expect(page.getByTestId("batch-total")).not.toHaveText("Bs 0,00");
  await page.getByRole("button", { name: "Confirmar ingreso de mercadería" }).click();
  await expect(page).toHaveURL(/\/compras\/[0-9a-f-]{36}\?nuevo=1$/);
  expect(await stockOfSku(item.sku)).toBe(before + 4);
  await logout(page);
});

test("3. venta con pagos mixtos (efectivo + QR) y ticket", async ({ page }) => {
  await login(page, SELLER);
  await ensureOpenCash(page);
  await scanCode(page, state.sku!);
  await expect(page.getByTestId("pos-total")).toHaveText(formatBs("349.00"));
  await page.getByLabel(/Monto del pago 1/).fill("200");
  await page.getByRole("button", { name: "+ Agregar otro pago" }).click();
  await page.getByRole("button", { name: /Completar el pago 2/ }).click();
  await expect(page.getByText("Pagos completos")).toBeVisible();
  await page.getByRole("button", { name: /Confirmar venta/ }).click();
  await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]{36}\/ticket\?nueva=1$/);
  state.sale = /ventas\/([0-9a-f-]{36})\/ticket/.exec(page.url())![1];
  const ticket = page.locator(".ticket");
  await expect(ticket).toContainText("Efectivo");
  await expect(ticket).toContainText("QR");
  const payments = await ownerQuery<{ method: string; amount: string }>("select method, amount::text from sale_payments where sale_id = $1 order by method", [state.sale]);
  expect(payments.map((p) => p.method)).toEqual(["efectivo", "qr"]);
  expect(Number(payments[0].amount) + Number(payments[1].amount)).toBe(349);
});

test("4. cambio de talla: el par vuelve, el otro sale y la venta lo muestra", async ({ page }) => {
  const [other] = await ownerQuery<{ sku: string; color: string; size: string }>(
    `select v.sku, c.name as color, z.label as size from stock_levels sl
       join variants v on v.id = sl.variant_id join models m on m.id = v.model_id
       join colors c on c.id = v.color_id join sizes z on z.id = v.size_id
      where m.name = 'Urbano' and sl.qty >= 2 and v.sku <> $1 order by v.sku limit 1`,
    [state.sku],
  );
  const before = { returned: await stockOfSku(state.sku!), replacement: await stockOfSku(other.sku) };
  await login(page, SELLER);
  await page.goto(`/ventas/${state.sale}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Registrar un cambio" }).click();
  await page.getByRole("checkbox", { name: /Urbano/ }).check();
  const search = page.getByRole("combobox", { name: /Cambiar Urbano/ });
  await search.fill(other.sku);
  await expect(page.getByRole("listbox", { name: "Resultados" }).getByRole("option").first()).toContainText("Urbano");
  await search.press("Enter");
  await page.getByLabel("Motivo del cambio").selectOption("talla");
  await page.getByRole("button", { name: "Confirmar el cambio" }).click();
  await expect(page.getByText(/Cambio registrado: el stock ya se movió/)).toBeVisible();
  expect(await stockOfSku(state.sku!)).toBe(before.returned + 1);
  expect(await stockOfSku(other.sku)).toBe(before.replacement - 1);
  await expect(page.getByRole("heading", { name: "Cambios de esta venta" })).toBeVisible();
});

test("5. anulación por el superadmin con motivo; el stock vuelve", async ({ page }) => {
  const wawa = await stockedSku("Wawa", 3);
  await login(page, SELLER);
  await ensureOpenCash(page);
  await scanCode(page, wawa.sku);
  await page.getByRole("button", { name: /Confirmar venta/ }).click();
  await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]{36}\/ticket\?nueva=1$/);
  state.voided = /ventas\/([0-9a-f-]{36})\/ticket/.exec(page.url())![1];
  const afterSale = await stockOfSku(wawa.sku);
  await logout(page);

  await login(page, ADMIN);
  await page.goto(`/ventas/${state.voided}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Anular esta venta" }).click();
  await page.getByLabel("Motivo de la anulación").fill("Venta duplicada en el viaje E2E");
  await page.getByLabel(/Entiendo que esta acción/).check();
  await page.getByRole("button", { name: "Confirmar anulación" }).click();
  await expect(page.getByRole("heading", { name: "Venta anulada" })).toBeVisible();
  expect((await saleStatus(state.voided)).status).toBe("voided");
  expect(await stockOfSku(wawa.sku)).toBe(afterSale + 1);
});

test("6. el reporte de hoy cuadra con la base y 7. el Excel suma lo mismo", async ({ page }) => {
  await login(page, ADMIN);
  const today = await todaySalesTotal();
  await page.goto("/reportes?periodo=hoy");
  await expect(page.locator(".kpi--hero .kpi__value")).toHaveText(formatBs(today.total));

  const response = await page.request.get("/reportes/exportar/ventas?periodo=hoy");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("spreadsheetml");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await response.body()) as unknown as ArrayBuffer);
  const sales = book.getWorksheet("Ventas")!;
  const total = sales.getRow(sales.rowCount).getCell("K").value as { result: number };
  expect(total.result).toBeCloseTo(Number(today.total), 2);
});

test("8. transferencia entre sucursales: abre La Paz, mueve stock, el vendedor solo ve el suyo y se vuelve a cerrar", async ({ page }) => {
  const item = await stockedSku("Colegial", 4);
  const label = `Colegial ${item.color} talla ${item.size}`;
  const centralBefore = await stockIn(item.sku, "Central");

  await login(page, ADMIN);
  // open La Paz (planned for mid-year)
  await page.goto("/sucursales");
  await page.getByRole("button", { name: "Activar La Paz" }).click();
  await expect(page.locator('[aria-labelledby="branches-title"] tbody tr', { hasText: "La Paz" })).toContainText("Activa");

  await page.goto("/sucursales/transferencias/nueva");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Sucursal de origen").selectOption({ label: "Central" });
  await page.getByLabel("Sucursal de destino").selectOption({ label: "La Paz" });
  await scanCode(page, item.sku);
  await expect(page.getByText(/Disponible en el origen/)).toBeVisible();
  await page.getByLabel(`Cantidad de ${label}`).fill(String(centralBefore + 1));
  await expect(page.getByText(new RegExp(`Solo hay ${centralBefore} en la sucursal de origen`))).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar transferencia" })).toBeDisabled();
  await page.getByLabel(`Cantidad de ${label}`).fill("2");
  await page.getByRole("button", { name: "Confirmar transferencia" }).click();
  await expect(page).toHaveURL(/\/sucursales\/transferencias\/[0-9a-f-]{36}\?nueva=1$/);
  await expect(page.getByText("Transferencia registrada: el stock ya se movió.")).toBeVisible();
  await expect(page.locator("tbody")).toContainText(item.sku);
  expect(await stockIn(item.sku, "Central")).toBe(centralBefore - 2);
  expect(await stockIn(item.sku, "La Paz")).toBe(2);

  // history
  await page.goto("/sucursales/transferencias");
  await expect(page.locator("tbody tr").first()).toContainText("Central");
  await expect(page.locator("tbody tr").first()).toContainText("La Paz");

  // La Paz has stock: it cannot be closed and the screen says why
  await page.goto("/sucursales");
  const laPaz = page.locator('[aria-labelledby="branches-title"] tbody tr', { hasText: "La Paz" });
  await expect(laPaz).toContainText("2 pares en stock");
  await expect(page.getByRole("button", { name: "Desactivar La Paz" })).toBeDisabled();
  await logout(page);

  // the seller of Central only sees Central stock
  await login(page, SELLER);
  await page.goto(`/stock?tamano=200`);
  await page.waitForLoadState("networkidle");
  const row = page.locator("tbody tr", { hasText: item.sku });
  await expect(row.locator("td").nth(4)).toHaveText(String(centralBefore - 2));
  await logout(page);

  // send it back and close La Paz again so the rest of the suite sees the usual state
  await login(page, ADMIN);
  await page.goto("/sucursales/transferencias/nueva");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Sucursal de origen").selectOption({ label: "La Paz" });
  await page.getByLabel("Sucursal de destino").selectOption({ label: "Central" });
  await scanCode(page, item.sku);
  await page.getByLabel(`Cantidad de ${label}`).fill("2");
  await page.getByRole("button", { name: "Confirmar transferencia" }).click();
  await expect(page).toHaveURL(/\/sucursales\/transferencias\/[0-9a-f-]{36}\?nueva=1$/);
  await page.goto("/sucursales");
  await page.getByRole("button", { name: "Desactivar La Paz" }).click();
  await expect(page.locator('[aria-labelledby="branches-title"] tbody tr', { hasText: "La Paz" })).toContainText("Inactiva");
  expect(await stockIn(item.sku, "Central")).toBe(centralBefore);
});

test("9. venta solo con teclado: F2, buscar, elegir, Ctrl+Enter", async ({ page }) => {
  const item = await stockedSku("Alba", 2);
  await login(page, SELLER);
  await ensureOpenCash(page);
  await page.goto("/ventas");
  await page.waitForLoadState("networkidle");
  const search = page.getByRole("combobox", { name: /Escanear o buscar producto/ });
  await expect(search).toBeFocused();
  // typed slowly like a person (a scanner would be a burst + Enter)
  await page.keyboard.press("F2");
  await page.keyboard.type(`alba ${item.color.toLowerCase()} ${item.size}`, { delay: 90 });
  await expect(page.getByRole("listbox", { name: "Resultados" }).getByRole("option").first()).toContainText("Alba");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("pos-total")).not.toHaveText("Bs 0,00");
  await expect(page.getByText("Todo listo. Ctrl + Enter para confirmar.")).toBeVisible();
  const before = await stockOfSku(item.sku);
  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/ventas\/[0-9a-f-]{36}\/ticket\?nueva=1$/);
  expect(await stockOfSku(item.sku)).toBe(before - 1);
});
