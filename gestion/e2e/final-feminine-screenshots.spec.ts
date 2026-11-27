import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { ownerQuery, stockedSku } from "./db";
import { ADMIN, ensureOpenCash, horizontalOverflow, login, scanCode, SELLER } from "./helpers";

/** Final redesign ("boutique suave"): key screens at phone, tablet and desktop widths. Small JPEGs on purpose. */
const WIDTHS = [375, 768, 1440] as const;
const OUT = path.join(__dirname, "screenshots", "final-feminine");

async function shoot(page: Page, name: string, width: number): Promise<void> {
  await page.waitForLoadState("networkidle");
  expect(await horizontalOverflow(page), `${name} @${width} desborda horizontalmente`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.jpg`), fullPage: true, type: "jpeg", quality: 72 });
}

const ADMIN_SCREENS: readonly (readonly [string, string])[] = [
  ["02-dashboard", "/dashboard"],
  ["04-stock", "/stock"],
  ["05-catalogo", "/catalogo"],
  ["06-etiquetas", "/catalogo/etiquetas"],
  ["07-reportes", "/reportes?periodo=mes"],
  ["08-reportes-modelos", "/reportes?periodo=mes&vista=modelos"],
  ["09-cajas", "/cajas"],
  ["10-clientes", "/clientes"],
  ["11-sucursales", "/sucursales"],
  ["12-transferencias", "/sucursales/transferencias"],
  ["13-compras", "/compras"],
  ["14-historial-ventas", "/ventas/historial"],
  ["15-usuarios", "/usuarios"],
  ["16-cuenta-contrasena", "/cuenta/contrasena"],
];

test.describe("final: capturas del rediseño", () => {
  test.setTimeout(240_000);

  for (const width of WIDTHS) {
    test(`restablecer contraseña y cambio obligatorio a ${width}px`, async ({ page, browser }) => {
      const username = `shot${Date.now().toString().slice(-8)}`;
      await ownerQuery(
        `insert into users (username, full_name, password_hash, role, branch_id)
         select $1, 'Vendedora Temporal', $2, 'seller', id from branches where name = 'Central'`,
        [username, bcrypt.hashSync("clave-inicial-prueba-1", 4)],
      );
      try {
        await page.setViewportSize({ width, height: 900 });
        await login(page, ADMIN);
        const [target] = await ownerQuery<{ id: string }>("select id from users where username = $1", [username]);
        await page.goto(`/usuarios/${target.id}/contrasena`);
        await page.getByRole("button", { name: "Sugerir una frase" }).click();
        await expect(page.getByLabel("Contraseña temporal", { exact: true })).toHaveValue(/-\d{2}$/);
        await shoot(page, "17-usuarios-restablecer", width);
        const temporary = await page.getByLabel("Contraseña temporal", { exact: true }).inputValue();
        await page.getByRole("button", { name: "Restablecer contraseña" }).click();
        await expect(page.getByText(/una sola vez/)).toBeVisible();
        await shoot(page, "18-usuarios-contrasena-temporal", width);

        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const seller = await context.newPage();
        await login(seller, { username, password: temporary });
        await expect(seller.getByRole("heading", { name: "Cambiar mi contraseña", level: 1 })).toBeVisible();
        await shoot(seller, "19-cambio-obligatorio", width);
        await context.close();
      } finally {
        await ownerQuery("delete from users where username = $1", [username]);
      }
    });

    test(`login y superadmin a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Ingrese a su cuenta" })).toBeVisible();
      await shoot(page, "01-login", width);

      await login(page, ADMIN);
      for (const [name, url] of ADMIN_SCREENS) {
        await page.goto(url);
        await expect(page.locator("main h1").first()).toBeVisible();
        await shoot(page, name, width);
      }
    });

    test(`vendedor a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page, SELLER);
      await ensureOpenCash(page);
      const product = await stockedSku("Urbano", 4);
      await scanCode(page, product.sku);
      await expect(page.getByTestId("pos-total")).not.toHaveText("Bs 0,00");
      await shoot(page, "03-pos-vendedor", width);
      for (const [name, url] of [
        ["24-vendedor-cuenta-contrasena", "/cuenta/contrasena"],
        ["20-vendedor-stock", "/stock"],
        ["21-vendedor-mi-caja", "/ventas/caja"],
        ["22-vendedor-clientes", "/clientes"],
        ["23-vendedor-mis-ventas", "/reportes?periodo=mes"],
      ] as const) {
        await page.goto(url);
        await expect(page.locator("main h1").first()).toBeVisible();
        await shoot(page, name, width);
      }
    });
  }
});
