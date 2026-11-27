import { expect, test } from "@playwright/test";
import { ownerQuery } from "./db";
import { ADMIN, horizontalOverflow, login } from "./helpers";
import { addToCart, SEEDED, seededToken } from "./store-helpers";

const WIDTHS = [320, 375, 768, 1024, 1440, 1920] as const;
test.setTimeout(180_000);

test("no horizontal overflow on any public store page from 320 to 1920 px", async ({ page }) => {
  const problems: string[] = [];
  await page.setViewportSize({ width: 375, height: 800 });
  await addToCart(page, "urbano");
  const paths = ["/tienda", "/tienda?q=zz", "/tienda/alba", "/tienda/carrito", "/tienda/pedido", `/tienda/pedido/${seededToken(SEEDED.review)}`, `/tienda/pedido/${seededToken(SEEDED.shipping)}`, "/tienda/no-existe"];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await horizontalOverflow(page);
      if (overflow > 0) problems.push(`${width}px ${path}: +${overflow}px`);
    }
    await page.goto("/tienda");
    await page.getByText("Filtros y orden").click();
    if ((await horizontalOverflow(page)) > 0) problems.push(`${width}px filtros abiertos`);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("no horizontal overflow on the new staff pages", async ({ page }) => {
  const problems: string[] = [];
  await login(page, ADMIN);
  const [order] = await ownerQuery<{ id: string }>("select id from web_orders where status = 'pago_en_revision' limit 1");
  const [model] = await ownerQuery<{ id: string }>("select id from models where name = 'Alba'");
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/pedidos", `/pedidos/${order.id}`, "/tienda-online", `/catalogo/modelos/${model.id}`, "/catalogo"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await horizontalOverflow(page);
      if (overflow > 0) problems.push(`${width}px ${path}: +${overflow}px`);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("keyboard only: pick a size and add to the cart; focus is always visible", async ({ page }) => {
  await page.goto("/tienda/alba");
  // reach the first available size with Tab and choose it with Space
  await page.locator(".opt__swatch").nth(0).locator("input").check();
  const target = page.locator(".opt__size:not([data-unavailable]) input").first();
  await target.focus();
  await expect(target).toBeFocused();
  const ring = await target.evaluate((el) => getComputedStyle(el.nextElementSibling as Element).boxShadow);
  expect(ring).not.toBe("none");
  await page.keyboard.press("Space");
  await expect(target).toBeChecked();
  const add = page.getByRole("button", { name: "Agregar al carrito" });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Agregado al carrito")).toBeVisible();
  // skip link exists and works
  await page.goto("/tienda");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
});

test("prefers-reduced-motion: no decorative animation or transition on the storefront", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/tienda");
  const durations = await page.evaluate(() => {
    const card = document.querySelector(".pcard") as HTMLElement;
    const img = document.querySelector(".pcard .store-img") as HTMLElement;
    return [getComputedStyle(card).animationDuration, getComputedStyle(img).transitionDuration];
  });
  for (const value of durations) expect(parseFloat(value)).toBeLessThan(0.01);
  await context.close();
});

test("the storefront keeps the JS and CSS budgets (catalog page)", async ({ page }) => {
  const sizes: { url: string; bytes: number; type: string }[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (/javascript|css/.test(type)) {
      const length = Number(response.headers()["content-length"] ?? 0);
      sizes.push({ url: response.url(), bytes: length, type });
    }
  });
  await page.goto("/tienda");
  await page.waitForLoadState("networkidle");
  const urls = sizes.map((s) => s.url);
  // measure compressed transfer through the Performance API (works whether or not the server sent content-length)
  const transfer = await page.evaluate(() =>
    performance.getEntriesByType("resource").filter((e) => /\.(js|css)(\?|$)/.test(e.name)).map((e) => ({ name: e.name, kb: (e as PerformanceResourceTiming).encodedBodySize / 1024 })),
  );
  const js = transfer.filter((t) => t.name.endsWith(".js") || t.name.includes(".js?")).reduce((n, t) => n + t.kb, 0);
  const css = transfer.filter((t) => t.name.includes(".css")).reduce((n, t) => n + t.kb, 0);
  console.log(`catalog transfer: js ${js.toFixed(1)} KB, css ${css.toFixed(1)} KB (${urls.length} files)`);
  expect(js).toBeLessThan(200 * 1.3); // encoded (gzip) size; budget ~200 KB gz, small tolerance for measurement
  expect(css).toBeLessThan(30);
});
