import { expect, test, type Page } from "@playwright/test";
import { ownerQuery } from "./db";
import { ADMIN, login, SELLER } from "./helpers";

test.describe.configure({ mode: "serial" });

function branchRow(page: Page, name: string) {
  return page.locator('[aria-labelledby="branches-title"] tbody tr', { hasText: name });
}

const tag = Date.now().toString().slice(-6);
const NAME = `Sucursal E2E ${tag}`;
const RENAMED = `Sucursal E2E ${tag} b`;

test.afterAll(async () => {
  // leave the shared dev database as the seed made it
  await ownerQuery("delete from users where username = $1", [`e2e.vend.${tag}`]);
  await ownerQuery("delete from branches where name in ($1, $2)", [NAME, RENAMED]);
});

test("el superadmin crea, edita, desactiva y reactiva una sucursal", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/sucursales");
  await page.waitForLoadState("networkidle");
  await expect(branchRow(page, "Central")).toContainText("Activa");
  await expect(branchRow(page, "La Paz")).toContainText("Inactiva");

  await page.getByLabel("Nombre").fill(NAME);
  await page.getByLabel("Ciudad").fill("Cochabamba");
  await page.getByRole("button", { name: "Crear sucursal" }).click();
  await expect(page.getByText(`Sucursal “${NAME}” creada.`)).toBeVisible();
  await expect(branchRow(page, NAME)).toContainText("Activa");

  // duplicate names are refused with a clear message
  await page.getByLabel("Nombre").fill(NAME.toUpperCase());
  await page.getByRole("button", { name: "Crear sucursal" }).click();
  await expect(page.getByText("Ya existe una sucursal con ese nombre.")).toBeVisible();

  await page.getByRole("link", { name: `Editar ${NAME}` }).click();
  await expect(page.getByRole("heading", { name: `Editar ${NAME}` })).toBeVisible();
  await page.getByLabel("Nombre").fill(RENAMED);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Sucursal actualizada.")).toBeVisible();
  await expect(branchRow(page, RENAMED)).toBeVisible();

  await page.getByRole("button", { name: `Desactivar ${RENAMED}` }).click();
  await expect(branchRow(page, RENAMED)).toContainText("Inactiva");
  await page.getByRole("button", { name: `Activar ${RENAMED}` }).click();
  await expect(branchRow(page, RENAMED)).toContainText("Activa");
});

test("una sucursal con stock o vendedores no se puede desactivar y la pantalla explica por qué", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/sucursales");
  const central = branchRow(page, "Central");
  await expect(central).toContainText(/en stock: transfiéralos a otra sucursal/);
  await expect(central).toContainText(/vendedor/);
  await expect(page.getByRole("button", { name: "Desactivar Central" })).toBeDisabled();
});

test("reasigna un vendedor a otra sucursal activa", async ({ page }) => {
  const username = `e2e.vend.${tag}`;
  const [central] = await ownerQuery<{ id: string }>("select id from branches where name = 'Central'");
  await ownerQuery(
    "insert into users (username, full_name, password_hash, role, branch_id) values ($1, 'Vendedor E2E', 'x', 'seller', $2)",
    [username, central.id],
  );
  await login(page, ADMIN);
  await page.goto("/sucursales");
  await page.waitForLoadState("networkidle");
  const row = page.locator("tr", { hasText: username });
  await row.getByLabel(`Sucursal de ${username}`).selectOption({ label: RENAMED });
  await row.getByRole("button", { name: "Asignar" }).click();
  await expect(row.getByText(/Vendedor reasignado/)).toBeVisible();
  const [user] = await ownerQuery<{ name: string }>("select b.name from users u join branches b on b.id = u.branch_id where u.username = $1", [username]);
  expect(user.name).toBe(RENAMED);
  await ownerQuery("update users set active = false where username = $1", [username]);
});

test("el vendedor no ve sucursales ajenas: el selector del superadmin no existe para él", async ({ page }) => {
  await login(page, SELLER);
  for (const path of ["/stock", "/reportes", "/ventas/historial"]) {
    await page.goto(`${path}?sucursal=${(await ownerQuery<{ id: string }>("select id from branches where name = 'La Paz'"))[0].id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Sucursal", { exact: true }), path).toHaveCount(0);
  }
  await page.goto("/ventas/historial");
  await expect(page.getByLabel("Sucursal", { exact: true })).toHaveCount(0);
});

test("el selector de sucursal del dashboard vive en la URL", async ({ page }) => {
  const [central] = await ownerQuery<{ id: string }>("select id from branches where name = 'Central'");
  await login(page, ADMIN);
  await page.goto("/dashboard");
  await page.getByLabel("Sucursal", { exact: true }).selectOption({ label: "Central" });
  await page.getByRole("button", { name: "Ver" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard\\?sucursal=${central.id}`));
  await expect(page.getByText(/Sucursal Central\./)).toBeVisible();
  await page.goto(`/dashboard?sucursal=${(await ownerQuery<{ id: string }>("select id from branches where name = 'La Paz'"))[0].id}`);
  await expect(page.getByText(/Sucursal La Paz\./)).toBeVisible();
  await expect(page.getByText("0 ventas").first()).toBeVisible();
});
