import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ownerQuery, stockedSku } from "./db";
import { ADMIN, ensureOpenCash, login, scanCode, SELLER } from "./helpers";

/** WCAG 2.2 A + AA, the standard the project promises. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const found: string[] = [];

/** Runs axe and records every violation with its screen; each test asserts the list is empty at its end. */
async function audit(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of violations) {
    found.push(`${name}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  }
}

test.afterEach(() => {
  const problems = found.splice(0);
  expect(problems, problems.join("\n")).toEqual([]);
});

test.describe("accesibilidad (axe, WCAG 2.2 AA)", () => {
  // each test walks many screens with a full axe pass: give it room on a slow machine
  test.setTimeout(120_000);

  test("login", async ({ page }) => {
    await page.goto("/login");
    await audit(page, "login");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await audit(page, "login con errores");
  });

  test("superadmin: pantallas principales", async ({ page }) => {
    await login(page, ADMIN);
    for (const path of [
      "/dashboard",
      "/dashboard?sucursal=none",
      "/stock",
      "/reportes?periodo=mes",
      "/reportes?periodo=mes&vista=modelos",
      "/reportes?periodo=mes&vista=stock",
      "/cajas",
      "/sucursales",
      "/sucursales/transferencias",
      "/sucursales/transferencias/nueva",
      "/compras",
      "/compras/nuevo",
      "/ventas/historial",
      "/usuarios",
      "/catalogo",
      "/clientes",
    ]) {
      await page.goto(path);
      await audit(page, `superadmin ${path}`);
    }
  });

  test("superadmin: POS con carrito y la lista de resultados abierta", async ({ page }) => {
    const item = await stockedSku("Urbano", 2);
    await login(page, ADMIN);
    await page.goto("/ventas");
    await page.waitForLoadState("networkidle");
    await scanCode(page, item.sku);
    await expect(page.getByTestId("pos-total")).not.toHaveText("Bs 0,00");
    await page.getByRole("button", { name: "+ Agregar otro pago" }).click();
    await audit(page, "POS carrito con dos pagos");
    await page.getByRole("combobox", { name: /Escanear o buscar producto/ }).fill("alba");
    await expect(page.getByRole("listbox", { name: "Resultados" }).getByRole("option").first()).toBeVisible();
    await audit(page, "POS con resultados de búsqueda");
  });

  test("contraseñas: cambiar la propia (ambos roles, con errores) y restablecer (superadmin)", async ({ page }) => {
    const [target] = await ownerQuery<{ id: string }>("select id from users where username = 'vendedor1'");
    await login(page, ADMIN);
    for (const path of ["/cuenta/contrasena", `/usuarios/${target.id}/contrasena`, "/usuarios"]) {
      await page.goto(path);
      await audit(page, `superadmin ${path}`);
    }
    await page.goto("/cuenta/contrasena");
    await page.getByLabel("Contraseña actual").fill("x");
    await page.getByLabel("Contraseña nueva", { exact: true }).fill("corta");
    await page.getByLabel("Repita la contraseña nueva").fill("corta");
    await page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(page.getByText(/al menos 12 caracteres/)).toBeVisible();
    await audit(page, "cuenta con errores");
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await login(page, SELLER);
    await page.goto("/cuenta/contrasena");
    await audit(page, "vendedor /cuenta/contrasena");
  });

  test("vendedor: POS, stock, reportes e historial", async ({ page }) => {
    await login(page, SELLER);
    await ensureOpenCash(page);
    for (const path of ["/ventas", "/stock", "/reportes", "/ventas/historial", "/ventas/caja", "/clientes"]) {
      await page.goto(path);
      await audit(page, `vendedor ${path}`);
    }
  });

  test("transferencia: formulario con un producto cargado y con una sola sucursal activa", async ({ page }) => {
    const item = await stockedSku("Colegial", 2);
    await login(page, ADMIN);
    await page.goto("/sucursales/transferencias/nueva");
    await audit(page, "transferencia (una sola sucursal activa)");

    await ownerQuery("update branches set active = true where name = 'La Paz'");
    try {
      await page.goto("/sucursales/transferencias/nueva");
      await page.waitForLoadState("networkidle");
      await scanCode(page, item.sku);
      await expect(page.getByText(/Disponible en el origen/)).toBeVisible();
      await page.getByLabel(/^Cantidad de Colegial/).fill("99999");
      await expect(page.getByRole("alert").filter({ hasText: "Solo hay" })).toBeVisible();
      await audit(page, "transferencia con un producto y un error de cantidad");
    } finally {
      await ownerQuery("update branches set active = false where name = 'La Paz'");
    }
  });

  test("paneles y diálogos: cambio, anulación, nuevo cliente y ticket", async ({ page }) => {
    const [sale] = await ownerQuery<{ id: string }>(
      `select s.id from sales s where s.status = 'completed'
          and not exists (select 1 from exchanges x where x.original_sale_id = s.id) order by s.created_at desc limit 1`,
    );
    await login(page, SELLER);
    await ensureOpenCash(page);
    await page.getByRole("button", { name: "Nuevo cliente" }).click();
    await audit(page, "POS: nuevo cliente");
    await page.goto(`/ventas/${sale.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Registrar un cambio" }).click();
    await audit(page, "venta: panel de cambio");
    await page.goto(`/ventas/${sale.id}/ticket`);
    await audit(page, "ticket");
    await page.context().clearCookies();
    await login(page, ADMIN);
    await page.goto(`/ventas/${sale.id}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Anular esta venta" }).click();
    await audit(page, "venta: panel de anulación");
  });

  test("movimiento reducido: sin transiciones ni animaciones perceptibles", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, SELLER);
    await page.goto("/ventas");
    const durations = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a, button, input, select")).map((el) => {
        const style = getComputedStyle(el);
        return `${style.transitionDuration}|${style.animationDuration}`;
      }),
    );
    for (const value of durations) {
      for (const part of value.split("|").flatMap((v) => v.split(","))) expect(parseFloat(part)).toBeLessThanOrEqual(0.001);
    }
  });

  test("foco visible: cada control alcanzable con Tab muestra un indicador", async ({ page }) => {
    await login(page, SELLER);
    await page.goto("/ventas");
    await page.waitForLoadState("networkidle");
    const seen = new Set<string>();
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const visible = style.boxShadow !== "none" || (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0);
        return { name: `${el.tagName}:${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? ""}`, visible };
      });
      if (info) {
        seen.add(info.name);
        expect(info.visible, `sin indicador de foco en ${info.name}`).toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});
