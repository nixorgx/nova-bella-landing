import { describe, expect, it } from "vitest";
import { cashClosing } from "@/features/cash/cash-math";

describe("cashClosing", () => {
  it("expects opening + cash sales", () => {
    expect(cashClosing({ openingAmount: "200.00", cashSales: "1045.50", counted: "1245.50" })).toEqual({
      expected: "1245.50",
      difference: "0.00",
      status: "balanced",
    });
  });
  it("reports a shortage (missing money) as negative", () => {
    const result = cashClosing({ openingAmount: "100", cashSales: "50", counted: "145,00" });
    expect(result).toMatchObject({ expected: "150.00", difference: "-5.00", status: "short" });
  });
  it("reports a surplus as positive", () => {
    expect(cashClosing({ openingAmount: "0", cashSales: "10", counted: "12" })).toMatchObject({
      difference: "2.00",
      status: "over",
    });
  });
  it("returns null difference while the counted amount is unreadable", () => {
    expect(cashClosing({ openingAmount: "0", cashSales: "10", counted: "" })).toMatchObject({
      expected: "10.00",
      difference: null,
      status: "pending",
    });
  });
});
