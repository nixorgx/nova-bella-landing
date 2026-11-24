import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { createBatch, getBatch, listBatches, listSuppliers } from "@/features/purchases/batches";
import { previewDraft, parseDraft, type PurchaseDraft } from "@/features/purchases/form-math";
import { applyModelPrice, listModelCosts } from "@/features/purchases/model-costs";
import { createRate, getLatestRate, listRates } from "@/features/purchases/rates";
import { getPricingSettings, savePricingSettings } from "@/features/settings/pricing-settings";
import { getMaxDiscountPct } from "@/features/settings/discount";
import { getStockMatrix } from "@/features/stock/matrix";
import { withUser } from "@/lib/db";
import { createBranch, createUser, createVariant, expectPgError, stockOf, type TestVariant } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

let branch: string;
let admin: SessionPayload;
let seller: SessionPayload;
let a: TestVariant;
let b: TestVariant;

const meta = (supplier: string | null = "Proveedor Uno") => ({
  branchId: branch,
  batchDate: "2026-03-10",
  supplier,
  notes: null,
});

function draftFor(items: PurchaseDraft["items"], freight = "150"): PurchaseDraft {
  return { rate70Input: "6,96", rate30Input: "10,50", splitInput: "70", freightInput: freight, items };
}

beforeAll(async () => {
  branch = await createBranch();
  [admin, seller] = await Promise.all([createUser("superadmin", null), createUser("seller", branch)]);
  [a, b] = await Promise.all([createVariant(), createVariant()]);
});

describe("createBatch through the feature layer", () => {
  it("stores the batch, raises stock, updates costs and matches the live preview to the cent", async () => {
    const draft = draftFor([
      { variantId: a.variantId, qtyInput: "4", costInput: "14,50" },
      { variantId: b.variantId, qtyInput: "6", costInput: "21" },
    ]);
    const parsed = parseDraft(draft);
    if (!parsed.ok) throw new Error("draft should be valid");

    const batchId = await createBatch(admin, meta(), parsed.value);

    expect(await stockOf(a.variantId, branch)).toBe(4);
    expect(await stockOf(b.variantId, branch)).toBe(6);

    const detail = await getBatch(admin, batchId);
    expect(detail).not.toBeNull();
    expect(detail?.rate70).toBe("6.9600");
    expect(detail?.freightBs).toBe("150.00");
    const preview = previewDraft(draft);
    for (const item of detail?.items ?? []) {
      const row = preview.rows.find((r) => r.variantId === item.variantId);
      expect(item.unitCostBsLanded, `variante ${item.sku}`).toBe(row?.unitBs);
    }
    const stored = (detail?.items ?? []).reduce((sum, i) => sum + Number(i.unitCostBsLanded) * i.qty, 0);
    expect(stored.toFixed(2)).toBe(preview.totalBs);

    const { rows } = await systemQuery("select last_cost_bs::text from variant_costs where variant_id = $1", [a.variantId]);
    expect(rows[0].last_cost_bs).toBe(preview.rows[0].unitBs);
  });

  it("rolls everything back when one line is invalid (unknown variant)", async () => {
    const draft = draftFor([
      { variantId: a.variantId, qtyInput: "1", costInput: "10" },
      { variantId: "00000000-0000-4000-8000-000000000000", qtyInput: "1", costInput: "10" },
    ]);
    const parsed = parseDraft(draft);
    if (!parsed.ok) throw new Error("draft should be valid");
    const before = await stockOf(a.variantId, branch);
    await expectPgError(createBatch(admin, meta(), parsed.value), "IN005");
    expect(await stockOf(a.variantId, branch)).toBe(before);
  });

  it("a seller cannot create a batch", async () => {
    const parsed = parseDraft(draftFor([{ variantId: a.variantId, qtyInput: "1", costInput: "10" }]));
    if (!parsed.ok) throw new Error("draft should be valid");
    await expectPgError(createBatch(seller, meta(), parsed.value), "42501");
  });
});

describe("batch list and detail", () => {
  it("filters by supplier, branch and date range", async () => {
    const parsed = parseDraft(draftFor([{ variantId: b.variantId, qtyInput: "2", costInput: "5" }], "0"));
    if (!parsed.ok) throw new Error("draft should be valid");
    const unique = `Prov-${Date.now()}`;
    await createBatch(admin, { ...meta(unique), batchDate: "2026-04-02" }, parsed.value);

    const request = { page: 1, pageSize: 20 };
    const bySupplier = await listBatches(admin, { supplier: unique.toLowerCase() }, request);
    expect(bySupplier.total).toBe(1);
    expect(bySupplier.rows[0]).toMatchObject({ supplier: unique, units: 2, products: 1, totalBs: "80.22" });
    expect((await listBatches(admin, { supplier: unique, from: "2026-04-03" }, request)).total).toBe(0);
    expect((await listBatches(admin, { supplier: unique, to: "2026-04-02", branchId: branch }, request)).total).toBe(1);
    expect(await listSuppliers(admin)).toContain(unique);
  });

  it("sellers get permission errors, never cost rows", async () => {
    const request = { page: 1, pageSize: 5 };
    await expectPgError(listBatches(seller, {}, request), "42501");
    await expectPgError(listRates(seller), "42501");
    await expectPgError(listModelCosts(seller), "42501");
    await expectPgError(getBatch(seller, "00000000-0000-4000-8000-000000000000"), "42501");
    await expect(getStockMatrix(seller, {})).rejects.toThrow();
  });
});

describe("exchange rates", () => {
  it("registers rates and returns the latest one first", async () => {
    await createRate(admin, { rateDate: "2026-01-05", officialRate: "6.96", parallelRate: "10.2" });
    await createRate(admin, { rateDate: "2099-12-30", officialRate: "6.96", parallelRate: "12.5" });
    const latest = await getLatestRate(admin);
    expect(latest).toMatchObject({ rateDate: "2099-12-30", parallelRate: "12.5000" });
    expect((await listRates(admin)).length).toBeGreaterThanOrEqual(2);
    await systemQuery("delete from exchange_rates where rate_date = '2099-12-30'");
  });

  it("rejects non positive rates at the database", async () => {
    await expectPgError(createRate(admin, { rateDate: "2026-01-05", officialRate: "0", parallelRate: "10" }), "23514");
  });
});

describe("price suggestions are never applied automatically", () => {
  it("a batch does not touch base_sale_price; applying is an explicit call", async () => {
    const costs = await listModelCosts(admin);
    const model = costs.find((m) => m.modelId === a.modelId);
    expect(model?.currentPrice).toBe("100.00");
    expect(model?.lastCostBs).toBeDefined();

    expect(await applyModelPrice(admin, a.modelId, "253,00")).toBe("253.00");
    const { rows } = await systemQuery("select base_sale_price::text as p from models where id = $1", [a.modelId]);
    expect(rows[0].p).toBe("253.00");
    await expect(applyModelPrice(admin, a.modelId, "0")).rejects.toThrow(RangeError);
    await expectPgError(applyModelPrice(seller, a.modelId, "50"), "42501");
  });
});

describe("stock matrix (superadmin)", () => {
  it("shows quantities with last and average cost", async () => {
    const matrix = await getStockMatrix(admin, { branchId: branch, modelId: b.modelId });
    expect(matrix).toHaveLength(1);
    const cell = Object.values(matrix[0].cells)[0];
    expect(cell.qty).toBeGreaterThanOrEqual(6);
    expect(cell.lastCostBs).not.toBeNull();
    expect(matrix[0].valueBs).not.toBe("0.00");
  });
});

describe("pricing settings", () => {
  const original = { targetMarginPct: "40", maxDiscountPct: null as string | null };
  afterAll(async () => {
    await savePricingSettings(admin, original);
  });

  it("superadmin saves the target margin; the database rejects 100 or more", async () => {
    await savePricingSettings(admin, { targetMarginPct: "35.5", maxDiscountPct: null });
    expect((await getPricingSettings(admin)).targetMarginPct).toBe("35.5");
    await expectPgError(savePricingSettings(admin, { targetMarginPct: "100", maxDiscountPct: null }), "23514");
  });

  it("sellers can read ONLY the discount limit and cannot write settings", async () => {
    const keys = await withUser(seller, (c) => c.query<{ key: string }>("select key from app_settings"));
    expect(keys.rows.map((r) => r.key)).toEqual(["max_discount_pct"]);
    expect(await getMaxDiscountPct(seller)).toBeNull();
    await expectPgError(savePricingSettings(seller, { targetMarginPct: "10", maxDiscountPct: null }), "42501");
  });
});
