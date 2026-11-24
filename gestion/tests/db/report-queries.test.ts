import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { todayKey } from "@/lib/format";
import { createExchange } from "@/features/exchanges/create-exchange";
import { voidSale } from "@/features/sales/void-sale";
import { getInventoryValue, getProfitByModel, getProfitSummary, getStockCosts } from "@/features/reports/cost-queries";
import {
  getDailySales,
  getModelSizeSales,
  getSalesBySeller,
  getSalesSummary,
  getStockVariants,
  listExchangesInPeriod,
  listTopDiscounts,
  listVoidsInPeriod,
  totalsByModel,
} from "@/features/reports/queries";
import { scopeFor } from "@/features/reports/scope";
import { systemQuery } from "../helpers/system";
import { addStock, createBranch, createUser, createVariant, expectPgError, rpcCreateSale } from "../helpers/fixtures";

let branch: string;
let seller: SessionPayload;
let otherSeller: SessionPayload;
let admin: SessionPayload;
let sellerScope: ReturnType<typeof scopeFor>;
let adminScope: ReturnType<typeof scopeFor>;

const today = todayKey();
const COST_KEY = /cost|margen|margin|profit|utilidad/i;

function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      found.push(key);
      keysOf(inner, found);
    }
  }
  return found;
}

async function sell(session: SessionPayload, lines: { v: string; qty: number; price: string }[], method = "efectivo") {
  const total = lines.reduce((sum, l) => sum + l.qty * Number(l.price), 0).toFixed(2);
  return withUser(session, (c) =>
    rpcCreateSale(c, { branchId: branch }, lines.map((l) => ({ variantId: l.v, qty: l.qty, finalPrice: l.price })), [{ method, amount: total }]),
  );
}

let alba38: string;
let alba39: string;
let urbano41: string;

beforeAll(async () => {
  branch = await createBranch();
  seller = await createUser("seller", branch);
  otherSeller = await createUser("seller", branch);
  admin = await createUser("superadmin", null);

  const mk = async (name: string, size: string, price: string, cost: string) => {
    const v = await createVariant(price);
    await systemQuery("update models set name = $2 where id = $1", [v.modelId, name]);
    await systemQuery("update sizes set label = $2, sort_order = $3 where id = (select size_id from variants where id = $1)", [v.variantId, size, Number(size)]);
    await addStock(v.variantId, branch, 20);
    await systemQuery("insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs) values ($1, $2, $2)", [v.variantId, cost]);
    return v.variantId;
  };
  const tag = Math.random().toString(36).slice(2, 7);
  alba38 = await mk(`Alba ${tag}`, "38", "200.00", "100.00");
  alba39 = await mk(`Alba ${tag}`, "39", "200.00", "100.00");
  urbano41 = await mk(`Urbano ${tag}`, "41", "300.00", "180.00");
  // (Alba 38 and 39 are separate models in the fixture; fine: each is its own model row)

  await sell(seller, [{ v: alba38, qty: 2, price: "200.00" }], "efectivo"); // 400
  await sell(seller, [{ v: urbano41, qty: 1, price: "270.00" }], "qr"); // 270, discounted
  await sell(otherSeller, [{ v: alba39, qty: 1, price: "200.00" }], "tarjeta"); // 200
  const toVoid = await sell(otherSeller, [{ v: alba38, qty: 1, price: "200.00" }], "efectivo"); // voided
  await voidSale(admin, { saleId: toVoid, reason: "Venta duplicada por error" });
  const exchanged = await sell(seller, [{ v: alba38, qty: 1, price: "200.00" }], "efectivo"); // 200, exchanged below
  await createExchange(seller, {
    saleId: exchanged, reason: "modelo", note: undefined, paymentMethod: "qr",
    lines: [{ returnedVariantId: alba38, newVariantId: urbano41, qty: 1, priceDiffOverride: undefined }],
  }); // +100 by QR

  sellerScope = scopeFor(seller, { from: today, to: today }, { branchId: "ignored-by-sellers" });
  adminScope = scopeFor(admin, { from: today, to: today }, { branchId: branch });
});

describe("scopeFor", () => {
  it("pins sellers to their branch and their own sales whatever is requested", () => {
    expect(sellerScope).toMatchObject({ branchId: branch, sellerId: seller.userId });
    expect(adminScope).toMatchObject({ branchId: branch, sellerId: null });
  });
});

describe("sales summary (superadmin scope)", () => {
  it("counts completed sales only, lists voids apart, and splits payments by method with exchange differences", async () => {
    const summary = await getSalesSummary(admin, adminScope);
    expect(summary).toMatchObject({ count: 4, amount: "1070.00", averageTicket: "267.50", units: 5, voidCount: 1, voidAmount: "200.00", exchangeCount: 1, exchangeNet: "100.00" });
    const byMethod = Object.fromEntries(summary.methods.map((m) => [m.method, m]));
    expect(byMethod.efectivo).toMatchObject({ sales: "600.00", exchanges: "0.00", net: "600.00" });
    expect(byMethod.qr).toMatchObject({ sales: "270.00", exchanges: "100.00", net: "370.00" });
    expect(byMethod.tarjeta).toMatchObject({ sales: "200.00", net: "200.00" });
    expect(summary.discountTotal).toBe("30.00"); // 270 charged vs 300 list
    expect(summary.discountedLines).toBe(1);
  });

  it("builds a daily series with the day's total", async () => {
    const days = await getDailySales(admin, adminScope);
    expect(days).toEqual([{ day: today, total: "1070.00", count: 4 }]);
  });

  it("ranks sellers and the discounts", async () => {
    const sellers = await getSalesBySeller(admin, adminScope);
    expect(sellers.map((s) => [s.count, s.amount])).toEqual([[3, "870.00"], [1, "200.00"]]);
    const discounts = await listTopDiscounts(admin, adminScope);
    expect(discounts[0]).toMatchObject({ discount: "30.00", percent: "10.0" });
  });

  it("lists exchanges and voids of the period", async () => {
    const exchanges = await listExchangesInPeriod(admin, adminScope);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ priceDiff: "100.00", method: "qr", qty: 1 });
    const voids = await listVoidsInPeriod(admin, adminScope);
    expect(voids).toHaveLength(1);
    expect(voids[0]).toMatchObject({ total: "200.00", reason: "Venta duplicada por error" });
  });
});

describe("models and sizes are net of exchanges", () => {
  it("moves the exchanged pair from the returned model to the new one", async () => {
    const rows = await getModelSizeSales(admin, adminScope);
    const albas = rows.filter((r) => r.size === "38");
    // Alba 38: sold 2 + 1 (voided one is excluded) - 1 exchanged = 2 ; Urbano 41: 1 sold + 1 from exchange = 2
    expect(albas.reduce((sum, r) => sum + r.units, 0)).toBe(2);
    const urbano = rows.find((r) => r.size === "41");
    expect(urbano).toMatchObject({ units: 2, revenue: "570.00" }); // 270 + (200 paid for the returned pair + 100 diff)
    const totals = totalsByModel(rows);
    expect(totals.reduce((sum, t) => sum + t.units, 0)).toBe(5);
    expect(totals.reduce((sum, t) => sum + Number(t.revenue), 0)).toBeCloseTo(1170, 2); // 1070 sales + 100 difference
  });
});

describe("profit (superadmin only)", () => {
  it("uses the cost snapshot: revenue - cost, exchange differences and cost swing included", async () => {
    const profit = await getProfitSummary(admin, adminScope);
    // revenue: 1070 sales + 100 diff = 1170
    // cost: sales 2*100 + 180 + 100 + 100 = 580 ; exchange delta: 180 (new) - 100 (returned) = 80 -> 660
    expect(profit).toMatchObject({ revenue: "1170.00", cost: "660.00", profit: "510.00", marginPct: "43.6", linesWithoutCost: 0 });
  });

  it("breaks profit down per model and values the inventory", async () => {
    const models = await getProfitByModel(admin, adminScope);
    expect(models.reduce((sum, m) => sum + Number(m.profit), 0)).toBeCloseTo(510, 2);
    const value = await getInventoryValue(admin, branch);
    // on hand: Alba 38 = 18 (x100), Alba 39 = 19 (x100), Urbano 41 = 18 (x180) at average cost
    expect(value).toMatchObject({ units: 55, value: "6940.00", variantsWithoutCost: 0 });
    const costs = await getStockCosts(admin, branch);
    expect(costs.filter((row) => row.qty > 0).every((row) => row.avgCost !== null)).toBe(true);
  });
});

describe("role isolation", () => {
  it("returns no cost, margin or profit key to a seller from any seller-safe report", async () => {
    const results = await Promise.all([
      getSalesSummary(seller, sellerScope),
      getDailySales(seller, sellerScope),
      getModelSizeSales(seller, sellerScope),
      getSalesBySeller(seller, sellerScope),
      listTopDiscounts(seller, sellerScope),
      listExchangesInPeriod(seller, sellerScope),
      listVoidsInPeriod(seller, sellerScope),
      getStockVariants(seller, null),
    ]);
    const keys = keysOf(results).filter((key) => COST_KEY.test(key));
    expect(keys).toEqual([]);
  });

  it("scopes a seller to their own sales", async () => {
    const summary = await getSalesSummary(seller, sellerScope);
    expect(summary).toMatchObject({ count: 3, amount: "870.00" });
  });

  it("refuses cost reports to sellers and the database refuses the cost tables", async () => {
    await expect(getProfitSummary(seller, sellerScope)).rejects.toThrow(/superadmin/);
    await expect(getProfitByModel(seller, sellerScope)).rejects.toThrow(/superadmin/);
    await expect(getInventoryValue(seller, branch)).rejects.toThrow(/superadmin/);
    await expect(getStockCosts(seller, branch)).rejects.toThrow(/superadmin/);
    await expectPgError(withUser(seller, (c) => c.query("select * from sale_item_costs")), "42501");
    await expectPgError(withUser(seller, (c) => c.query("select * from exchange_costs")), "42501");
  });
});

describe("stock report", () => {
  it("lists every active variant of the branch with its quantity", async () => {
    const rows = await getStockVariants(admin, branch);
    expect(rows.length).toBeGreaterThanOrEqual(3); // every active variant, 0 when it has no stock here
    expect(rows.map((r) => r.qty).filter((qty) => qty > 0).sort()).toEqual([18, 18, 19]);
  });
});
