import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { ownerQuery } from "./db";
import { COST_WORDS, login, SELLER, visibleMarkup } from "./helpers";

const LEAKS = new RegExp(`${COST_WORDS.source}|permission denied|\\bat .*\\.(ts|js)x?:\\d+|select .* from`, "i");

async function expectClean(page: Page, path: string): Promise<void> {
  const raw = await page.request.get(path);
  expect(raw.status(), path).toBeLessThan(500);
  expect(visibleMarkup(await raw.text()).match(LEAKS)?.[0] ?? null, `HTML crudo de ${path}`).toBeNull();
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  expect(visibleMarkup(await page.content()).match(LEAKS)?.[0] ?? null, `DOM de ${path}`).toBeNull();
}

test.describe("demo 3: el vendedor no ve costos ni accede a lo del superadmin", () => {
  test("reportes, cajas, cambios y anulaciones del vendedor no traen datos de costo", async ({ page }) => {
    await login(page, SELLER);
    const [exchanged] = await ownerQuery<{ id: string }>("select original_sale_id as id from exchanges order by created_at desc limit 1");
    const [voided] = await ownerQuery<{ id: string }>("select id from sales where status = 'voided' order by voided_at desc limit 1");
    const [session] = await ownerQuery<{ id: string }>(
      "select cs.id from cash_sessions cs join users u on u.id = cs.opened_by where u.username = 'vendedor1' order by cs.opened_at desc limit 1",
    );
    const [group] = await ownerQuery<{ group_id: string }>("select coalesce(group_id, id) as group_id from exchanges where original_sale_id = $1 limit 1", [exchanged.id]);

    for (const path of [
      "/reportes", "/reportes?periodo=hoy", "/reportes?periodo=semana&vista=modelos", "/reportes?vista=cambios",
      "/reportes?vista=rentabilidad", "/reportes?vista=stock", "/reportes?vista=vendedores",
      `/ventas/${exchanged.id}`, `/ventas/${exchanged.id}/ticket`, `/ventas/${exchanged.id}/ticket?cambio=${group.group_id}`,
      `/ventas/${voided.id}`, `/ventas/caja/${session.id}`, "/ventas/caja",
    ]) {
      await expectClean(page, path);
    }
  });

  test("el vendedor no ve el botón de anular ni los reportes con costo, y es devuelto de las rutas del superadmin", async ({ page }) => {
    await login(page, SELLER);
    const [sale] = await ownerQuery<{ id: string }>("select id from sales where status = 'completed' order by created_at desc limit 1");
    await page.goto(`/ventas/${sale.id}`);
    const html = await page.content();
    expect(html).not.toContain("Anular esta venta");
    expect(html).not.toContain("Confirmar anulación");

    for (const path of ["/cajas", "/dashboard", `/cajas/${sale.id}`]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/ventas$/);
    }
    // a link asking for the cost view falls back to the summary
    await page.goto("/reportes?vista=rentabilidad");
    await expect(page.getByRole("link", { name: "Resumen" })).toHaveAttribute("aria-current", "page");
  });

  test("las exportaciones con costo responden 403 al vendedor y sin sesión piden iniciar sesión", async ({ page, playwright }) => {
    await login(page, SELLER);
    for (const report of ["rentabilidad", "compras"]) {
      const response = await page.request.get(`/reportes/exportar/${report}?periodo=mes`);
      expect(response.status(), report).toBe(403);
      const body = await response.text();
      expect(body).toContain("superadmin");
      expect(response.headers()["content-type"]).toContain("json");
    }
    expect((await page.request.get("/reportes/exportar/no-existe")).status()).toBe(404);

    const anonymous = await playwright.request.newContext({ baseURL: `http://localhost:${process.env.E2E_PORT ?? 3100}` });
    const bounced = await anonymous.get("/reportes/exportar/ventas", { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308]).toContain(bounced.status());
    await anonymous.dispose();
  });

  test("ninguna celda del Excel del vendedor menciona costos, utilidad o USD", async ({ page }) => {
    await login(page, SELLER);
    for (const path of ["/reportes/exportar/ventas?periodo=mes", "/reportes/exportar/stock", "/reportes/exportar/caja?periodo=mes"]) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load((await response.body()) as unknown as ArrayBuffer);
      const found: string[] = [];
      book.eachSheet((sheet) =>
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            if (typeof cell.value === "string" && /cost|margen|utilidad|\busd\b|landed/i.test(cell.value)) found.push(`${sheet.name}!${cell.address}`);
          }),
        ),
      );
      expect(found, path).toEqual([]);
    }
  });
});
