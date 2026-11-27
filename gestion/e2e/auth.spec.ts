import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { ADMIN, SELLER } from "./helpers";

async function login(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(user.username);
  await page.getByLabel("Contraseña").fill(user.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

test("anonymous visitors are sent to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/usuarios");
  await expect(page).toHaveURL(/\/login$/);
});

test("wrong credentials show one generic message", async ({ page }) => {
  await login(page, { username: "naty", password: "incorrecta" });
  await expect(page.locator(".notice--error")).toHaveText("Usuario o contraseña incorrectos.");
  await login(page, { username: "no-existe", password: "incorrecta" });
  await expect(page.locator(".notice--error")).toHaveText("Usuario o contraseña incorrectos.");
});

test("repeated failures are rate limited", async ({ page }) => {
  await page.goto("/login");
  const target = `bloqueado${Date.now()}`;
  for (let i = 0; i < 6; i++) {
    await page.getByLabel("Usuario").fill(target);
    await page.getByLabel("Contraseña").fill(`mala-${i}`);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Ingresar" }).click(),
    ]);
    await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
  }
  await expect(page.locator(".notice--error")).toContainText("Demasiados intentos");
});

test("superadmin sees the full menu and manages sellers", async ({ page }) => {
  await login(page, ADMIN);
  await expect(page).toHaveURL(/\/dashboard$/);
  const nav = page.getByRole("navigation", { name: "Principal" });
  for (const label of ["Dashboard", "Catálogo", "Compras", "Ventas", "Clientes", "Cajas", "Reportes", "Sucursales", "Usuarios"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  await nav.getByRole("link", { name: "Usuarios" }).click();
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();

  const username = `prueba${Date.now().toString().slice(-6)}`;
  await page.getByLabel("Usuario", { exact: true }).fill(username);
  await page.getByLabel("Nombre completo").fill("Vendedora de Prueba");
  await page.getByLabel("Sucursal").selectOption({ label: "Central" });
  await page.getByLabel("Contraseña inicial").fill("corta");
  await page.getByRole("button", { name: "Crear vendedor" }).click();
  await expect(page.getByText("al menos 12 caracteres")).toBeVisible();

  await page.getByLabel("Contraseña inicial").fill("una-clave-larga-1");
  await page.getByRole("button", { name: "Crear vendedor" }).click();
  await expect(page.getByText(`Vendedor “${username}” creado.`)).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(username) });
  await expect(row.getByText("Activo")).toBeVisible();
  await row.getByRole("button", { name: "Desactivar" }).click();
  await expect(page.getByRole("row", { name: new RegExp(username) }).getByText("Inactivo")).toBeVisible();

  // deactivated users cannot log in
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, { username, password: "una-clave-larga-1" });
  await expect(page.locator(".notice--error")).toHaveText("Usuario o contraseña incorrectos.");
});

test("seller is confined to seller routes and never sees cost data", async ({ page }) => {
  await login(page, SELLER);
  await expect(page).toHaveURL(/\/ventas$/);
  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav.getByRole("link")).toHaveText(["Ventas", /^Pedidos web/, "Clientes", "Stock", "Reportes"]);

  for (const forbidden of ["/usuarios", "/compras", "/dashboard", "/cajas", "/catalogo"]) {
    await page.goto(forbidden);
    await expect(page).toHaveURL(/\/ventas$/);
  }

  await page.goto("/stock");
  await expect(page.getByRole("heading", { name: "Stock" })).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toContainText("Bs");
  const html = (await page.content()).toLowerCase();
  expect(html).not.toContain("costo");
  expect(html).not.toContain("avg_cost");

  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/ventas");
  await expect(page).toHaveURL(/\/login$/);
});

test("signed-in users skip the login page", async ({ page }) => {
  await login(page, SELLER);
  await expect(page).toHaveURL(/\/ventas$/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/ventas$/);
});

test("revoking a user's sessions ends the old cookie and does not loop on /login", async ({ page }) => {
  await login(page, SELLER);
  await expect(page).toHaveURL(/\/ventas$/);

  // "Logout everywhere": the version counter in the database moves past the one in the cookie.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("update users set token_version = token_version + 1 where lower(username) = 'vendedor1'");
  } finally {
    await client.end();
  }

  await page.goto("/stock");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
  // the stale cookie was cleared, so a fresh login works and /login is not bounced
  await login(page, SELLER);
  await expect(page).toHaveURL(/\/ventas$/);
});
