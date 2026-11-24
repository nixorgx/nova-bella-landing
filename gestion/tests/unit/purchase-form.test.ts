import { describe, expect, it } from "vitest";
import { calculateBatchCosts } from "@/lib/costing";
import { previewDraft, type PurchaseDraft } from "@/features/purchases/form-math";

const draft = (over: Partial<PurchaseDraft> = {}): PurchaseDraft => ({
  rate70Input: "6,96",
  rate30Input: "10,50",
  splitInput: "70",
  freightInput: "0",
  items: [
    { variantId: "a", qtyInput: "4", costInput: "14,50" },
    { variantId: "b", qtyInput: "6", costInput: "21" },
  ],
  ...over,
});

describe("previewDraft", () => {
  it("matches calculateLandedCost / calculateBatchCosts exactly (the SQL function parity)", () => {
    const preview = previewDraft(draft({ freightInput: "150" }));
    expect(preview.ready).toBe(true);
    const expected = calculateBatchCosts({
      rate70: "6.96",
      rate30: "10.50",
      splitPct: "70",
      freightBs: "150",
      items: [
        { variantId: "a", qty: 4, unitCostUsd: "14.50" },
        { variantId: "b", qty: 6, unitCostUsd: "21.00" },
      ],
    });
    expect(preview.rows.map((r) => r.unitBs)).toEqual(expected.items.map((i) => i.unitCostBsLanded.toFixed(2)));
    expect(preview.totalBs).toBe(expected.totalBs.toFixed(2));
    expect(preview.totalUnits).toBe(10);
    expect(preview.freightPerUnit).toBe("15.00");
  });

  it("prorates freight per unit over every unit of the batch", () => {
    const preview = previewDraft(
      draft({ freightInput: "100", items: [{ variantId: "a", qtyInput: "3", costInput: "0" }, { variantId: "b", qtyInput: "1", costInput: "0" }] }),
    );
    expect(preview.rows.map((r) => r.unitBs)).toEqual(["25.00", "25.00"]);
    expect(preview.totalBs).toBe("100.00");
  });

  it("shows the blended exchange rate", () => {
    expect(previewDraft(draft()).blendedRate).toBe("8.0220"); // .7*6.96 + .3*10.5
  });

  it("is not ready without items", () => {
    const preview = previewDraft(draft({ items: [] }));
    expect(preview.ready).toBe(false);
    expect(preview.errors.items).toMatch(/al menos un/i);
  });

  it("flags unreadable inputs per field without throwing", () => {
    const preview = previewDraft(draft({ rate70Input: "abc", splitInput: "120", freightInput: "-3" }));
    expect(preview.ready).toBe(false);
    expect(preview.errors.rate70).toBeDefined();
    expect(preview.errors.split).toBeDefined();
    expect(preview.errors.freight).toBeDefined();
  });

  it("flags bad rows but still totals the good ones", () => {
    const preview = previewDraft(draft({ items: [{ variantId: "a", qtyInput: "0", costInput: "10" }, { variantId: "b", qtyInput: "2", costInput: "10" }] }));
    expect(preview.ready).toBe(false);
    expect(preview.rows[0].error).toMatch(/cantidad/i);
    expect(preview.rows[1].error).toBeUndefined();
    expect(preview.totalUnits).toBe(2);
  });

  it("rejects costs with more than 2 decimals (the RPC stores cents)", () => {
    const preview = previewDraft(draft({ items: [{ variantId: "a", qtyInput: "1", costInput: "10,555" }] }));
    expect(preview.rows[0].error).toMatch(/costo/i);
  });

  it("handles large batches without float drift", () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ variantId: `v${i}`, qtyInput: "12", costInput: "19,99" }));
    const preview = previewDraft(draft({ items, freightInput: "1234,56" }));
    expect(preview.ready).toBe(true);
    expect(preview.totalUnits).toBe(2400);
  });
});
