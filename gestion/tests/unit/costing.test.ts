import { describe, expect, it } from "vitest";
import { calculateBatchCosts, calculateLandedCost } from "@/lib/costing";

const base = { unitCostUsd: "10", rate70: "6.96", rate30: "10.5", totalUnits: 1 };

describe("calculateLandedCost", () => {
  it("applies the 70/30 exchange-rate split by default", () => {
    // 10 * (0.7 * 6.96 + 0.3 * 10.5) = 10 * 8.022
    expect(calculateLandedCost(base).toFixed(2)).toBe("80.22");
  });

  it("prorates freight per unit across the whole batch", () => {
    const cost = calculateLandedCost({ ...base, freightBs: "100", totalUnits: 40 });
    expect(cost.toFixed(2)).toBe("82.72");
  });

  it("treats missing freight as zero", () => {
    expect(calculateLandedCost({ ...base, freightBs: undefined }).toFixed(2)).toBe("80.22");
    expect(calculateLandedCost({ ...base, freightBs: 0 }).toFixed(2)).toBe("80.22");
  });

  it("supports a split other than 70", () => {
    const input = { unitCostUsd: 10, rate70: 7, rate30: 9, totalUnits: 5 };
    expect(calculateLandedCost({ ...input, splitPct: 50 }).toFixed(2)).toBe("80.00");
    expect(calculateLandedCost({ ...input, splitPct: 100 }).toFixed(2)).toBe("70.00");
    expect(calculateLandedCost({ ...input, splitPct: 0 }).toFixed(2)).toBe("90.00");
    expect(calculateLandedCost({ ...input, splitPct: 25.5 }).toFixed(2)).toBe("84.90");
  });

  it("rounds half up to 2 decimals (not banker's rounding)", () => {
    const half = { unitCostUsd: 1, rate70: "0.125", rate30: "0.125", totalUnits: 1 };
    expect(calculateLandedCost(half).toFixed(2)).toBe("0.13");
    expect(calculateLandedCost({ ...half, rate70: "0.135", rate30: "0.135" }).toFixed(2)).toBe("0.14");
  });

  it("rounds only once, at the end", () => {
    // 100 / 3 = 33.333... freight only
    const cost = calculateLandedCost({
      unitCostUsd: 0,
      rate70: 7,
      rate30: 9,
      freightBs: 100,
      totalUnits: 3,
    });
    expect(cost.toFixed(2)).toBe("33.33");
  });

  it("accepts Decimal-compatible strings and numbers", () => {
    expect(calculateLandedCost({ ...base, unitCostUsd: 10, rate70: 6.96 }).toFixed(2)).toBe("80.22");
  });

  it.each([
    ["negative cost", { unitCostUsd: -1 }],
    ["zero rate70", { rate70: 0 }],
    ["negative rate30", { rate30: -3 }],
    ["split above 100", { splitPct: 100.01 }],
    ["negative split", { splitPct: -1 }],
    ["negative freight", { freightBs: -5 }],
    ["zero units", { totalUnits: 0 }],
    ["fractional units", { totalUnits: 1.5 }],
  ])("rejects %s", (_label, override) => {
    expect(() => calculateLandedCost({ ...base, ...override })).toThrow(RangeError);
  });

  it("rejects non numeric values", () => {
    expect(() => calculateLandedCost({ ...base, unitCostUsd: "abc" })).toThrow(RangeError);
  });
});

describe("calculateBatchCosts", () => {
  it("computes per-line landed cost, units and total", () => {
    const result = calculateBatchCosts({
      rate70: "6.96",
      rate30: "10.5",
      freightBs: "100",
      items: [
        { variantId: "a", qty: 10, unitCostUsd: "10" },
        { variantId: "b", qty: 30, unitCostUsd: "20" },
      ],
    });
    expect(result.totalUnits).toBe(40);
    expect(result.items[0].unitCostBsLanded.toFixed(2)).toBe("82.72");
    expect(result.items[1].unitCostBsLanded.toFixed(2)).toBe("162.94");
    expect(result.items[1].lineTotalBs.toFixed(2)).toBe("4888.20");
    expect(result.totalBs.toFixed(2)).toBe("5715.40");
  });

  it("rejects an empty batch", () => {
    expect(() => calculateBatchCosts({ rate70: 7, rate30: 9, items: [] })).toThrow(RangeError);
  });

  it("rejects a non-positive quantity", () => {
    expect(() =>
      calculateBatchCosts({ rate70: 7, rate30: 9, items: [{ variantId: "a", qty: 0, unitCostUsd: 1 }] }),
    ).toThrow(RangeError);
  });
});
