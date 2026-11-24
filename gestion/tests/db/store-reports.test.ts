import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { todayKey } from "@/lib/format";
import { listSalesForExport } from "@/features/reports/export-queries";
import { getSalesSummary, getDailySales } from "@/features/reports/queries";
import { filterQuery, readReportFilters, scopeFor } from "@/features/reports/scope";
import { listSales } from "@/features/sales/queries";
import { addStock, createBranch, createUser, createVariant, sellOne } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

const today = todayKey();
let branch: string;
let admin: SessionPayload;
let seller: SessionPayload;

beforeAll(async () => {
  branch = await createBranch(true, true);
  admin = await createUser("superadmin", null);
  seller = await createUser("seller", branch);
  const v = await createVariant("100.00");
  await addStock(v.variantId, branch, 10);
  await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00"); // counter sale
  // a web sale exactly as web_order_confirm writes it (no cash session, channel web, rung under the admin)
  const sale = await systemQuery<{ id: string }>(
    "insert into sales (branch_id, seller_id, channel, doc_type, total) values ($1, $2, 'web', 'nota_venta', 250.00) returning id",
    [branch, admin.userId],
  );
  await systemQuery("insert into sale_items (sale_id, branch_id, variant_id, qty, list_price, final_price) values ($1, $2, $3, 1, 250, 250)", [sale.rows[0].id, branch, v.variantId]);
  await systemQuery("insert into sale_payments (sale_id, branch_id, method, amount) values ($1, $2, 'qr', 250)", [sale.rows[0].id, branch]);
});

const range = { from: today, to: today };

describe("channel as a report dimension", () => {
  it("filters the summary by channel and sums both when unfiltered", async () => {
    const both = await getSalesSummary(admin, scopeFor(admin, range, { branchId: branch }));
    const web = await getSalesSummary(admin, scopeFor(admin, range, { branchId: branch, channel: "web" }));
    const store = await getSalesSummary(admin, scopeFor(admin, range, { branchId: branch, channel: "store" }));
    expect(both.count).toBe(2);
    expect(web).toMatchObject({ count: 1, amount: "250.00" });
    expect(store).toMatchObject({ count: 1, amount: "100.00" });
    const days = await getDailySales(admin, scopeFor(admin, range, { branchId: branch, channel: "web" }));
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(1);
  });

  it("export rows carry the channel and respect the filter", async () => {
    const rows = await listSalesForExport(admin, scopeFor(admin, range, { branchId: branch }));
    expect(rows.map((r) => r.channel).sort()).toEqual(["store", "web"]);
    const webOnly = await listSalesForExport(admin, scopeFor(admin, range, { branchId: branch, channel: "web" }));
    expect(webOnly).toHaveLength(1);
    expect(webOnly[0]).not.toHaveProperty("cost");
  });

  it("a seller still sees only their own counter sales, with no cost anywhere", async () => {
    const summary = await getSalesSummary(seller, scopeFor(seller, range));
    expect(summary.count).toBe(1);
    expect(JSON.stringify(summary)).not.toMatch(/cost|margen|utilidad/i);
    const history = await listSales(seller, {}, { page: 1, pageSize: 50 });
    expect(history.rows.some((r) => r.channel === "web")).toBe(true); // branch history shows the web sale, labelled
  });

  it("the channel travels in shareable URLs", () => {
    const filters = readReportFilters({ periodo: "mes", canal: "web" }, today);
    expect(filters.channel).toBe("web");
    expect(filterQuery(filters)).toContain("canal=web");
    expect(readReportFilters({ canal: "otro" }, today).channel).toBeNull();
    expect(readReportFilters({ canal: "tienda" }, today).channel).toBe("store");
  });
});
