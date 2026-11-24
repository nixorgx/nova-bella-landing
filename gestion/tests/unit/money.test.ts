import { describe, expect, it } from "vitest";
import {
  addMoney,
  formatBs,
  isValidMoneyInput,
  moneyEquals,
  mulMoney,
  parseMoney,
  subMoney,
  sumMoney,
  toMoney,
} from "@/lib/money";

describe("toMoney", () => {
  it("rounds half up to 2 decimals and returns a string", () => {
    expect(toMoney("1.005")).toBe("1.01");
    expect(toMoney("2.675")).toBe("2.68");
    expect(toMoney(10)).toBe("10.00");
    expect(toMoney("0.1")).toBe("0.10");
  });

  it("throws on non numeric input", () => {
    expect(() => toMoney("abc")).toThrow(RangeError);
  });
});

describe("arithmetic", () => {
  it("avoids float errors", () => {
    expect(addMoney("0.1", "0.2")).toBe("0.30");
    expect(subMoney("1.10", "0.30")).toBe("0.80");
    expect(mulMoney("19.99", 3)).toBe("59.97");
  });

  it("sums lists and handles empty", () => {
    expect(sumMoney(["10.10", "20.20", "0.05"])).toBe("30.35");
    expect(sumMoney([])).toBe("0.00");
  });

  it("compares money by value", () => {
    expect(moneyEquals("10", "10.00")).toBe(true);
    expect(moneyEquals("10.01", "10.00")).toBe(false);
  });
});

describe("formatBs", () => {
  it("uses es-BO separators and prefix", () => {
    expect(formatBs("1234.5")).toBe("Bs 1.234,50");
    expect(formatBs(0)).toBe("Bs 0,00");
    expect(formatBs("1234567.891")).toBe("Bs 1.234.567,89");
    expect(formatBs("999.999")).toBe("Bs 1.000,00");
  });

  it("formats negatives with a leading minus", () => {
    expect(formatBs("-45.5")).toBe("-Bs 45,50");
  });

  it("returns a dash for null or invalid values", () => {
    expect(formatBs(null)).toBe("-");
    expect(formatBs(undefined)).toBe("-");
    expect(formatBs("x")).toBe("-");
  });
});

describe("parseMoney", () => {
  it.each([
    ["12,50", "12.50"],
    ["12.50", "12.50"],
    ["1.234,50", "1234.50"],
    ["1,234.50", "1234.50"],
    [" 100 ", "100.00"],
    ["Bs 15", "15.00"],
  ])("parses %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3x", "--5", "12,505"])("returns null for %s", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("validates money input", () => {
    expect(isValidMoneyInput("10,5")).toBe(true);
    expect(isValidMoneyInput("nope")).toBe(false);
  });
});
