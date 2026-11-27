import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/lib/auth/guards";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { todayKey } from "@/lib/format";
import { listOpenSessionReports } from "@/features/cash/session-report";
import { searchVariants, resolveScan } from "@/features/catalog/search";
import { branchFilterFor } from "@/features/branches/scope";
import { buildExport } from "@/features/reports/excel/export-service";
import { getDashboard } from "@/features/reports/dashboard-queries";
import { getSalesSummary, getStockVariants } from "@/features/reports/queries";
import { resolvePeriod } from "@/features/reports/period";
import { scopeFor } from "@/features/reports/scope";
import { getSaleDetail, listSales } from "@/features/sales/queries";
import { listStock } from "@/features/stock/queries";
import { addStock, createBranch, createUser, createVariant, expectPgError, rpcCreateSale, stockOf, type TestVariant } from "../helpers/fixtures";

/** Two branches with the SAME variant on shelf and one sale each; a seller and the superadmin. */
let branchA: string;
let branchB: string;
let sellerA: SessionPayload;
let admin: SessionPayload;
let variant: TestVariant;
let saleA: string;
let saleB: string;

const asUser = (session: SessionPayload): AuthUser => ({
  mustChangePassword: false,
  id: session.userId,
  username: "x",
  fullName: "Prueba",
  role: session.role,
  branchId: session.branchId,
  branchName: "Sucursal",
});

beforeAll(async () => {
  [branchA, branchB] = await Promise.all([createBranch(), createBranch()]);
  [sellerA, admin] = await Promise.all([createUser("seller", branchA), createUser("superadmin", null)]);
  const sellerB = await createUser("seller", branchB);
  variant = await createVariant("100.00");
  await addStock(variant.variantId, branchA, 10);
  await addStock(variant.variantId, branchB, 4);
  const sell = (s: SessionPayload, branch: string, qty: number, total: string) =>
    withUser(s, (c) => rpcCreateSale(c, { branchId: branch }, [{ variantId: variant.variantId, qty, finalPrice: "100.00" }], [{ method: "efectivo", amount: total }]));
  saleA = await sell(sellerA, branchA, 1, "100.00");
  saleB = await sell(sellerB, branchB, 3, "300.00");
});

const range = () => resolvePeriod({ periodo: "hoy" });

describe("a seller of branch A never reaches branch B (database)", () => {
  it("cannot sell stock that sits in another branch", async () => {
    await expectPgError(
      withUser(sellerA, (c) => rpcCreateSale(c, { branchId: branchB }, [{ variantId: variant.variantId, qty: 1, finalPrice: "100.00" }], [{ method: "efectivo", amount: "100.00" }])),
      "IN004",
    );
    expect(await stockOf(variant.variantId, branchB)).toBe(1);
  });

  it("sees only its own stock, sales and sale details", async () => {
    const stock = await listStock(asUser(sellerA), { page: 1, pageSize: 200 });
    const row = stock.rows.find((r) => r.sku === variant.sku);
    expect(row?.qty).toBe(9);

    const own = await listSales(sellerA, {}, { page: 1, pageSize: 50 });
    expect(own.rows.every((s) => s.branchId === branchA)).toBe(true);
    expect(own.rows.map((s) => s.id)).toContain(saleA);
    expect(own.rows.map((s) => s.id)).not.toContain(saleB);
    // forcing the other branch in the filter returns nothing: RLS, not the UI, is the wall
    const forged = await listSales(sellerA, { branchId: branchB }, { page: 1, pageSize: 50 });
    expect(forged.total).toBe(0);
    expect(await getSaleDetail(sellerA, saleB)).toBeNull();
    expect(await getSaleDetail(sellerA, saleA)).not.toBeNull();
  });

  it("report queries ignore a forged branch and stay on its branch", async () => {
    const scope = scopeFor(sellerA, range(), { branchId: branchB });
    expect(scope.branchId).toBe(branchA);
    const summary = await getSalesSummary(sellerA, scope);
    expect(summary.amount).toBe("100.00");
    const stock = await getStockVariants(sellerA, branchB);
    expect(stock.find((r) => r.sku === variant.sku)?.qty).toBe(9);
  });

  it("search and scan lookups count stock only in its own branch, whatever branch is asked for", async () => {
    const hits = await searchVariants(sellerA, { query: variant.sku, branchId: branchB });
    expect(hits[0]?.stock).toBe(9);
    const scanned = await resolveScan(sellerA, variant.sku, branchB);
    expect(scanned?.stock).toBe(9);
  });

  it("cash dashboards of the other branch are invisible", async () => {
    const open = await listOpenSessionReports(sellerA, branchB);
    expect(open.every((s) => s.branchId === branchA)).toBe(true);
  });

  it("cannot read the transfer history or move stock", async () => {
    await expectPgError(withUser(sellerA, (c) => c.query("select * from stock_transfers")), "42501");
    await expectPgError(
      withUser(sellerA, (c) => c.query("select create_stock_transfer($1, $2, $3::jsonb)", [branchA, branchB, JSON.stringify([{ variant_id: variant.variantId, qty: 1 }])])),
      "42501",
    );
  });
});

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  return book;
}

/** Completed sale rows of the "ventas" workbook: [branch name, total]. */
function saleRows(book: ExcelJS.Workbook): { branch: string; total: number }[] {
  const found: { branch: string; total: number }[] = [];
  book.eachSheet((sheet) =>
    sheet.eachRow((row) => {
      const v = row.values as unknown[];
      if (typeof v[1] === "string" && /^\d{6}$/.test(v[1]) && typeof v[11] === "number") found.push({ branch: String(v[3]), total: v[11] as number });
    }),
  );
  return found;
}

async function branchName(id: string): Promise<string> {
  const { rows } = await withUser(admin, (c) => c.query<{ name: string }>("select name from branches where id = $1", [id]));
  return rows[0].name;
}

describe("Excel exports respect the branch", () => {
  const params = (extra: Record<string, string>) => ({ periodo: "hoy", ...extra });

  it("a seller's sales export holds only their own sale, even when asking for another branch", async () => {
    const book = await load((await buildExport(asUser(sellerA), "ventas", params({ sucursal: branchB }))).buffer);
    expect(saleRows(book)).toEqual([{ branch: await branchName(branchA), total: 100 }]);
  });

  it("a seller's stock export counts only their branch", async () => {
    const book = await load((await buildExport(asUser(sellerA), "stock", params({ sucursal: branchB }))).buffer);
    let row: unknown[] | undefined;
    book.eachSheet((sheet) =>
      sheet.eachRow((r) => {
        if ((r.values as unknown[]).includes(variant.sku)) row = r.values as unknown[];
      }),
    );
    expect(row).toBeDefined();
    expect(row).toContain(9);
    expect(row).not.toContain(4);
    expect(row).not.toContain(13);
  });

  it("a seller cannot export the cash session of another branch", async () => {
    const { rows } = await withUser(admin, (c) => c.query<{ id: string }>("select id from cash_sessions where branch_id = $1 limit 1", [branchB]));
    await expect(buildExport(asUser(sellerA), "caja", { sesion: rows[0].id })).rejects.toThrow(RangeError);
  });

  it("the superadmin export honours the branch filter", async () => {
    const [onlyB, onlyA, all] = await Promise.all(
      ([{ sucursal: branchB }, { sucursal: branchA }, {}] as Record<string, string>[]).map(async (extra) => load((await buildExport(asUser(admin), "ventas", params(extra))).buffer)),
    );
    expect(saleRows(onlyB)).toEqual([{ branch: await branchName(branchB), total: 300 }]);
    expect(saleRows(onlyA)).toEqual([{ branch: await branchName(branchA), total: 100 }]);
    expect(saleRows(all).length).toBeGreaterThanOrEqual(2);
  });

  it("the stock export of the superadmin counts the selected branch only", async () => {
    const book = await load((await buildExport(asUser(admin), "stock", params({ sucursal: branchB }))).buffer);
    let row: unknown[] | undefined;
    book.eachSheet((sheet) => sheet.eachRow((r) => { if ((r.values as unknown[]).includes(variant.sku)) row = r.values as unknown[]; }));
    expect(row).toContain(1);
    expect(row).not.toContain(10);
  });
});

describe("superadmin branch selector", () => {
  it("branchFilterFor pins sellers and reads the URL for the superadmin", () => {
    expect(branchFilterFor({ role: "seller", branchId: branchA }, branchB)).toBe(branchA);
    expect(branchFilterFor({ role: "superadmin", branchId: null }, branchB)).toBe(branchB);
    expect(branchFilterFor({ role: "superadmin", branchId: null }, "not-a-uuid")).toBeNull();
    expect(branchFilterFor({ role: "superadmin", branchId: null }, undefined)).toBeNull();
  });

  it("dashboard figures change with the selected branch", async () => {
    const today = todayKey();
    const [a, b, all] = await Promise.all([
      getDashboard(admin, today, branchA),
      getDashboard(admin, today, branchB),
      getDashboard(admin, today, null),
    ]);
    expect(a.month.amount).toBe("100.00");
    expect(b.month.amount).toBe("300.00");
    expect(Number(all.month.amount)).toBeGreaterThanOrEqual(400);
    expect(a.openCash.every((s) => s.branchId === branchA)).toBe(true);
    expect(b.movements.every((m) => m.branchName === b.movements[0]?.branchName)).toBe(true);
  });
});
