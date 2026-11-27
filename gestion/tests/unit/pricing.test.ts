import { describe, expect, it } from "vitest";
import { evaluatePrice, marginPct, suggestPrice } from "@/features/purchases/pricing";

describe("suggestPrice", () => {
  it("prices for the target margin on the sale price and rounds up to a whole Bs", () => {
    expect(suggestPrice("100.00", "40")).toBe("167.00"); // 166.67 -> 167
    expect(suggestPrice("90.00", "50")).toBe("180.00"); // exact
    expect(suggestPrice("151.50", "35")).toBe("234.00"); // 233.08
  });
  it("never suggests below cost", () => {
    expect(suggestPrice("80.00", "0")).toBe("80.00");
    expect(suggestPrice("80.01", "0")).toBe("81.00");
  });
  it("refuses a margin of 100% or more", () => {
    expect(() => suggestPrice("10.00", "100")).toThrow(RangeError);
  });
});

describe("marginPct", () => {
  it("is (price - cost) / price in percent, one decimal", () => {
    expect(marginPct("200.00", "120.00")).toBe("40.0");
    expect(marginPct("189.00", "151.50")).toBe("19.8");
  });
  it("is negative when selling below cost and null without a price", () => {
    expect(marginPct("100.00", "120.00")).toBe("-20.0");
    expect(marginPct("0.00", "10.00")).toBeNull();
  });
});

describe("evaluatePrice", () => {
  it("warns when the current margin is under the target", () => {
    const result = evaluatePrice({ currentPrice: "189.00", costBs: "151.50", targetMarginPct: "40" });
    expect(result.belowTarget).toBe(true);
    expect(result.suggestedPrice).toBe("253.00");
    expect(result.currentMargin).toBe("19.8");
    expect(result.suggestedMargin).toBe("40.1");
  });
  it("is fine when the margin already meets the target", () => {
    const result = evaluatePrice({ currentPrice: "300.00", costBs: "150.00", targetMarginPct: "40" });
    expect(result.belowTarget).toBe(false);
  });
  it("treats exactly the target as fine", () => {
    expect(evaluatePrice({ currentPrice: "200.00", costBs: "120.00", targetMarginPct: "40" }).belowTarget).toBe(false);
  });
});
