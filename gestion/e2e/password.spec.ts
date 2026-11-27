import { expect, test, type Browser, type Page } from "@playwright/test";
import { ownerQuery } from "./db";
import { ADMIN, horizontalOverflow, login, SELLER } from "./helpers";

/**
 * Password management. Everything runs on TEMPORARY sellers created (and deleted) by the test: the
 * real superadmin and vendedor1 passwords are never touched.
 */
const FIRST = "clave-inicial-prueba-1";
const SECOND = "segunda-clave-prueba-22";
const created: string[] = [];

function freshUsername(): string {
  const name = `pw${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
  created.push(name);
  return name;
}

test.afterAll(async () => {
  for (const username of created) await ownerQuery("delete from users where username = $1", [username]);
});

async function createSellerAsAdmin(page: Page, username: string, password = FIRST): Promise<void> {
  await login(page, ADMIN);
  await page.goto("/usuarios");
  await page.getByLabel("Usuario", { exact: true }).fill(username);
  await page.getByLabel("Nombre completo").fill("Vendedora Temporal");
  await page.getByLabel("Sucursal").selectOption({ label: "Central" });
  await page.getByLabel("Contraseña inicial").fill(password);
  await page.getByRole("button", { name: "Crear vendedor" }).click();
  await expect(page.getByText(`Vendedor “${username}” creado.`)).toBeVisible();
}

/** The form resets after every submit (passwords are never kept on screen), so each try refills it. */
async function submitChange(page: Page, current: string, next: string, confirm: string): Promise<void> {
  await page.getByLabel("Contraseña actual").fill(current);
  await page.getByLabel("Contraseña nueva", { exact: true }).fill(next);
  await page.getByLabel("Repita la contraseña nueva").fill(confirm);
  await page.getByRole("button", { name: "Cambiar contraseña" }).click();
}

async function freshContext(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("cada usuario cambia su propia contraseña: errores claros, aviso de éxito y las demás sesiones se cierran", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const username = freshUsername();
  await createSellerAsAdmin(page, username);

  const a = await freshContext(browser);
  const b = await freshContext(browser);
  try {
    await login(a.page, { username, password: FIRST });
    await login(b.page, { username, password: FIRST });

    // entry point: the account block of the menu
    await a.page.getByRole("link", { name: /Cambiar contraseña/ }).click();
    await expect(a.page).toHaveURL(/\/cuenta\/contrasena$/);
    await expect(a.page.getByRole("heading", { name: "Cambiar mi contraseña", level: 1 })).toBeVisible();

    // wrong current password: one generic message, nothing changes
    await submitChange(a.page, "no-es-esta-clave-1", SECOND, SECOND);
    await expect(a.page.getByText("La contraseña actual no es correcta.")).toBeVisible();

    // policy errors
    await submitChange(a.page, FIRST, "corta", "corta");
    await expect(a.page.getByText(/al menos 12 caracteres/)).toBeVisible();
    await submitChange(a.page, FIRST, SECOND, "otra-distinta-123456");
    await expect(a.page.getByText("Las contraseñas no coinciden.")).toBeVisible();
    await submitChange(a.page, FIRST, FIRST, FIRST);
    await expect(a.page.getByText("La contraseña nueva debe ser distinta de la actual.")).toBeVisible();

    // success: toast, this session stays valid
    await submitChange(a.page, FIRST, SECOND, SECOND);
    await expect(a.page.getByRole("status").getByText(/Su contraseña se cambió/)).toBeVisible();
    await a.page.goto("/ventas");
    await expect(a.page).toHaveURL(/\/ventas$/);

    // the other open session is dead
    await b.page.goto("/stock");
    await expect(b.page).toHaveURL(/\/login$/);

    // old password no longer works, the new one does
    await a.page.getByRole("button", { name: "Salir" }).click();
    await expect(a.page).toHaveURL(/\/login$/);
    await login(a.page, { username, password: FIRST }).catch(() => undefined);
    await expect(a.page.locator(".notice--error")).toHaveText("Usuario o contraseña incorrectos.");
    await login(a.page, { username, password: SECOND });
    await expect(a.page).toHaveURL(/\/ventas$/);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("el superadmin restablece una contraseña, la persona debe cambiarla al ingresar y no puede usar nada más hasta entonces", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const username = freshUsername();
  await createSellerAsAdmin(page, username);

  await page.getByRole("link", { name: `Restablecer contraseña de ${username}` }).click();
  await expect(page.getByRole("heading", { name: "Restablecer contraseña", level: 1 })).toBeVisible();

  // a readable suggestion made of real words
  await page.getByRole("button", { name: "Sugerir una frase" }).click();
  const field = page.getByLabel("Contraseña temporal", { exact: true });
  await expect(field).toHaveValue(/^([A-Z][a-z]+-){4}\d{2}$/);
  const temporary = await field.inputValue();
  await expect(page.getByLabel("Pedir que la cambie al ingresar")).toBeChecked();

  await page.getByRole("button", { name: "Restablecer contraseña" }).click();
  await expect(page.getByLabel("Contraseña temporal")).toHaveText(temporary);
  await expect(page.getByText(/una sola vez/)).toBeVisible();

  // Usuarios shows the pending change
  await page.getByRole("link", { name: "Volver a Usuarios" }).click();
  await expect(page.getByRole("row", { name: new RegExp(username) }).getByText("Cambiar al ingresar")).toBeVisible();

  const seller = await freshContext(browser);
  try {
    await login(seller.page, { username, password: temporary });
    await expect(seller.page).toHaveURL(/\/cuenta\/contrasena$/);
    await expect(seller.page.getByText(/contraseña temporal/)).toBeVisible();
    await expect(seller.page.getByRole("navigation", { name: "Principal" })).toHaveCount(0);
    for (const path of ["/ventas", "/stock", "/clientes"]) {
      await seller.page.goto(path);
      await expect(seller.page).toHaveURL(/\/cuenta\/contrasena$/);
    }
    expect((await seller.page.request.get("/api/variantes/buscar?q=a")).status()).not.toBe(200);

    await seller.page.getByLabel("Contraseña actual").fill(temporary);
    await seller.page.getByLabel("Contraseña nueva", { exact: true }).fill(SECOND);
    await seller.page.getByLabel("Repita la contraseña nueva").fill(SECOND);
    await seller.page.getByRole("button", { name: "Cambiar contraseña" }).click();
    await expect(seller.page).toHaveURL(/\/ventas$/);
    await expect(seller.page.getByRole("navigation", { name: "Principal" })).toBeVisible();
  } finally {
    await seller.context.close();
  }
});

test("un vendedor no llega a restablecer contraseñas ni ve costos en las pantallas nuevas", async ({ page }) => {
  const [target] = await ownerQuery<{ id: string }>("select id from users where username = 'vendedor1'");
  await login(page, SELLER);
  await page.goto(`/usuarios/${target.id}/contrasena`);
  await expect(page).toHaveURL(/\/ventas$/);
  await page.goto("/cuenta/contrasena");
  await expect(page.getByRole("heading", { name: "Cambiar mi contraseña", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Usuarios", exact: true })).toHaveCount(0);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/costo|utilidad|margen/i);
});

test("las pantallas de contraseña no desbordan en 320 y 1920 px", async ({ page }) => {
  const [target] = await ownerQuery<{ id: string }>("select id from users where username = 'vendedor1'");
  await login(page, ADMIN);
  for (const width of [320, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/cuenta/contrasena", `/usuarios/${target.id}/contrasena`, "/usuarios"]) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(await horizontalOverflow(page), `${path} @${width}`).toBeLessThanOrEqual(0);
    }
  }
});
