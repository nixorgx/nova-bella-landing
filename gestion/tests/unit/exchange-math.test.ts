import { describe, expect, it } from "vitest";
import {
  checkOverride,
  computeExchangeDiff,
  netOfLines,
  settlementOf,
} from "@/features/exchanges/price-diff";
import { cashClosing, expectedCash } from "@/features/cash/cash-math";

describe("computeExchangeDiff", () => {
  it("is (new list price - price actually paid) * qty", () => {
    expect(computeExchangeDiff({ paidUnit: "90.00", newPrice: "130.00", qty: 1 })).toBe("40.00");
    expect(computeExchangeDiff({ paidUnit: "90.00", newPrice: "130.00", qty: 2 })).toBe("80.00");
  });
  it("is negative when the new pair is cheaper (refund) and zero for the same price", () => {
    expect(computeExchangeDiff({ paidUnit: "150.00", newPrice: "120.00", qty: 1 })).toBe("-30.00");
    expect(computeExchangeDiff({ paidUnit: "120.00", newPrice: "120.00", qty: 3 })).toBe("0.00");
  });
  it("rounds half up to centavos like the database", () => {
    expect(computeExchangeDiff({ paidUnit: "33.333333", newPrice: "50.00", qty: 3 })).toBe("50.00");
    expect(computeExchangeDiff({ paidUnit: "10.005", newPrice: "10.00", qty: 1 })).toBe("-0.01");
  });
});

describe("settlementOf / netOfLines", () => {
  it("says whether to collect, refund or nothing", () => {
    expect(settlementOf("40.00")).toEqual({ direction: "cobrar", amount: "40.00" });
    expect(settlementOf("-12.50")).toEqual({ direction: "devolver", amount: "12.50" });
    expect(settlementOf("0.00")).toEqual({ direction: "ninguna", amount: "0.00" });
  });
  it("nets the lines of one exchange (an extra charge can offset a refund)", () => {
    expect(netOfLines(["40.00", "-30.00", "5.50"])).toBe("15.50");
    expect(netOfLines([])).toBe("0.00");
  });
});

describe("checkOverride (superadmin bounds, same as create_exchange)", () => {
  const base = { paidUnit: "90.00", newPrice: "100.00", qty: 2 };
  it("accepts a refund up to what was paid and a charge up to the new list price", () => {
    expect(checkOverride({ ...base, diff: "-180.00" })).toBeNull();
    expect(checkOverride({ ...base, diff: "200.00" })).toBeNull();
  });
  it("rejects values beyond those bounds or with more than two decimals", () => {
    expect(checkOverride({ ...base, diff: "-180.01" })).toMatch(/límites/);
    expect(checkOverride({ ...base, diff: "200.01" })).toMatch(/límites/);
    expect(checkOverride({ ...base, diff: "10.123" })).toMatch(/2 decimales/);
  });
});

describe("expected cash with exchanges", () => {
  it("is opening + cash sales + cash collected - cash refunded", () => {
    expect(expectedCash({ openingAmount: "200.00", cashSales: "1045.50", cashExchangeNet: "-30.00" })).toBe("1215.50");
    expect(expectedCash({ openingAmount: "200.00", cashSales: "100.00" })).toBe("300.00");
  });
  it("feeds the closing difference", () => {
    expect(cashClosing({ openingAmount: "100", cashSales: "50", cashExchangeNet: "-20", counted: "130" })).toEqual({
      expected: "130.00",
      difference: "0.00",
      status: "balanced",
    });
  });
});
