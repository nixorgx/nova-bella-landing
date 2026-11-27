import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { launch } from "chrome-launcher";
import { deriveOrderToken } from "../src/features/store/order-token";
import { loadEnv } from "./lib/load-env";
import { say, warn } from "./lib/log";

/**
 * Lighthouse over the screens that matter (public store included), against a running `npm run build && npm start`
 * with a seeded database. Chrome comes from Playwright's chromium (no system install needed).
 *   npm run perf:lighthouse            (BASE_URL defaults to http://localhost:3100)
 * Results: e2e/perf/lighthouse.json plus a table on stdout.
 */
loadEnv();
const BASE_URL = process.env.PERF_URL ?? "http://localhost:3100";
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const TARGETS = { lcpMs: 2500, tbtMs: 200, cls: 0.1, fcpMs: 1500 } as const;

interface Page {
  readonly name: string;
  readonly path: string;
  readonly role: "none" | "superadmin" | "seller";
}

/** Token of a seeded demo order (payment pending), for the public order-status page. */
function demoOrderPath(): string {
  const secret = process.env.ORDER_TOKEN_SECRET;
  if (!secret) throw new Error("Falta ORDER_TOKEN_SECRET en .env.local.");
  return `/tienda/pedido/${deriveOrderToken("seed-demo-pending-0001", secret)}`;
}

const PAGES: readonly Page[] = [
  // public store (anonymous, mobile profile)
  { name: "Tienda: catálogo", path: "/tienda", role: "none" },
  { name: "Tienda: producto", path: "/tienda/alba", role: "none" },
  { name: "Tienda: carrito", path: "/tienda/carrito", role: "none" },
  { name: "Tienda: pedido (QR)", path: demoOrderPath(), role: "none" },
  { name: "Pedidos web (superadmin)", path: "/pedidos", role: "superadmin" },
  { name: "Tienda online (superadmin)", path: "/tienda-online", role: "superadmin" },
  { name: "Login", path: "/login", role: "none" },
  { name: "POS (vendedor)", path: "/ventas", role: "seller" },
  { name: "Dashboard (superadmin)", path: "/dashboard", role: "superadmin" },
  { name: "Reportes (superadmin)", path: "/reportes?periodo=mes", role: "superadmin" },
  { name: "Stock (superadmin)", path: "/stock", role: "superadmin" },
];

async function sessionCookie(role: "superadmin" | "seller"): Promise<string> {
  const username = role === "superadmin" ? (process.env.SEED_SUPERADMIN_USERNAME || "naty") : "vendedor1";
  const password = process.env[role === "superadmin" ? "SEED_SUPERADMIN_PASSWORD" : "SEED_SELLER_PASSWORD"];
  if (!password) throw new Error("Falta SEED_*_PASSWORD en .env.local para iniciar sesion.");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Usuario").fill(username);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.waitForURL((url) => !url.pathname.endsWith("/login"));
    const cookie = (await page.context().cookies()).find((c) => c.name === "inv_session");
    if (!cookie) throw new Error("No se obtuvo la cookie de sesion.");
    return `${cookie.name}=${cookie.value}`;
  } finally {
    await browser.close();
  }
}

interface Row {
  readonly name: string;
  readonly performance: number;
  readonly accessibility: number;
  readonly bestPractices: number;
  readonly fcpMs: number;
  readonly lcpMs: number;
  readonly tbtMs: number;
  readonly cls: number;
  readonly jsKb: number;
  readonly cssKb: number;
  readonly lcpElement: string;
}

const pass = (row: Row): boolean =>
  row.lcpMs < TARGETS.lcpMs && row.tbtMs < TARGETS.tbtMs && row.cls < TARGETS.cls && row.fcpMs < TARGETS.fcpMs;

async function main(): Promise<void> {
  const { default: lighthouse } = (await import("lighthouse")) as unknown as {
    default: (url: string, flags: Record<string, unknown>) => Promise<{ lhr: Record<string, any> } | undefined>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const cookies = {
    superadmin: await sessionCookie("superadmin"),
    seller: await sessionCookie("seller"),
  } as const;
  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });
  const rows: Row[] = [];
  try {
    for (const page of PAGES) {
      const samples: Row[] = [];
      for (let run = 0; run < RUNS; run += 1) samples.push(await measure(page));
      // Median run by LCP: single Lighthouse runs on a loaded laptop vary a lot.
      rows.push([...samples].sort((a, b) => a.lcpMs - b.lcpMs)[Math.floor(samples.length / 2)]);
    }
  } finally {
    await chrome.kill();
  }
  async function measure(page: Page): Promise<Row> {
      const extraHeaders = page.role === "none" ? undefined : { Cookie: cookies[page.role] };
      const result = await lighthouse(`${BASE_URL}${page.path}`, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices"],
        extraHeaders,
        disableStorageReset: false,
      });
      if (!result) throw new Error(`Lighthouse no devolvio resultado para ${page.name}`);
      const { lhr } = result;
      if (lhr.runtimeError) throw new Error(`Lighthouse fallo en ${page.name}: ${lhr.runtimeError.code} ${lhr.runtimeError.message}`);
      const lcpDetails = lhr.audits["largest-contentful-paint-element"]?.details?.items as { items?: { node?: { snippet?: string; selector?: string } }[] }[] | undefined;
      const lcpNode = lcpDetails?.[0]?.items?.[0]?.node;
      const audit = (id: string): number => Number(lhr.audits[id]?.numericValue ?? 0);
      const items = (lhr.audits["network-requests"]?.details?.items ?? []) as { resourceType?: string; transferSize?: number }[];
      const kb = (type: string): number =>
        Math.round(items.filter((i) => i.resourceType === type).reduce((sum, i) => sum + (i.transferSize ?? 0), 0) / 102.4) / 10;
      return {
        name: page.name,
        performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
        accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
        bestPractices: Math.round((lhr.categories["best-practices"]?.score ?? 0) * 100),
        fcpMs: Math.round(audit("first-contentful-paint")),
        lcpMs: Math.round(audit("largest-contentful-paint")),
        tbtMs: Math.round(audit("total-blocking-time")),
        cls: Math.round(audit("cumulative-layout-shift") * 1000) / 1000,
        jsKb: kb("Script"),
        cssKb: kb("Stylesheet"),
        lcpElement: String(lcpNode?.selector ?? lcpNode?.snippet ?? "").slice(0, 80),
      };
  }
  const outDir = path.resolve(__dirname, "../e2e/perf");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "lighthouse.json"), `${JSON.stringify({ baseUrl: BASE_URL, targets: TARGETS, rows }, null, 2)}\n`);
  say("Pagina | Perf | A11y | BP | FCP ms | LCP ms | TBT ms | CLS | JS KB | CSS KB | Objetivos");
  for (const row of rows) {
    say(`${row.name} | ${row.performance} | ${row.accessibility} | ${row.bestPractices} | ${row.fcpMs} | ${row.lcpMs} | ${row.tbtMs} | ${row.cls} | ${row.jsKb} | ${row.cssKb} | ${pass(row) ? "OK" : "REVISAR"} | LCP: ${row.lcpElement}`);
  }
}

main().catch((error: Error) => {
  warn(error.message);
  process.exit(1);
});
