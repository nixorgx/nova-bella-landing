import { describe, expect, it } from "vitest";
import {
  addVariant,
  cartTotals,
  discountFloor,
  lineIssue,
  lineTotal,
  removeLine,
  setLinePrice,
  setLineQty,
  type CartLine,
} from "@/features/sales/cart";
import type { VariantHit } from "@/features/catalog/types";

const hit = (over: Partial<VariantHit> = {}): VariantHit => ({
  variantId: "v1",
  sku: "ALB-NEG-38",
  barcode: null,
  modelId: "m1",
  model: "Alba",
  line: "Dama",
  color: "Negro",
  colorHex: "#000000",
  size: "38",
  price: "189.00",
  stock: 5,
  active: true,
  modelActive: true,
  ...over,
});

const line = (over: Partial<CartLine> = {}): CartLine => ({
  variantId: "v1",
  sku: "ALB-NEG-38",
  model: "Alba",
  color: "Negro",
  colorHex: "#000000",
  size: "38",
  listPrice: "189.00",
  stock: 5,
  qty: 1,
  priceInput: "189,00",
  ...over,
});

describe("discountFloor", () => {
  it("is null without a limit", () => {
    expect(discountFloor("189.00", null)).toBeNull();
  });
  it("mirrors round(list * (1 - pct/100), 2) from create_sale", () => {
    expect(discountFloor("189.00", "20")).toBe("151.20");
    expect(discountFloor("329.00", "15")).toBe("279.65");
    expect(discountFloor("100.00", "0")).toBe("100.00");
    // half cent rounds up: 33.33 * 0.85 = 28.3305 -> 28.33 ; 10.05 * 0.5 = 5.025 -> 5.03
    expect(discountFloor("10.05", "50")).toBe("5.03");
  });
});

describe("adding to the cart", () => {
  it("adds a new variant with its list price as the final price", () => {
    const { lines, notice } = addVariant([], hit());
    expect(notice).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ variantId: "v1", qty: 1, listPrice: "189.00", priceInput: "189.00" });
  });

  it("increments the quantity when the same variant is scanned again", () => {
    const first = addVariant([], hit()).lines;
    const second = addVariant(first, hit()).lines;
    expect(second).toHaveLength(1);
    expect(second[0].qty).toBe(2);
    expect(first[0].qty).toBe(1); // immutable
  });

  it("refuses a variant without stock", () => {
    const { lines, notice } = addVariant([], hit({ stock: 0 }));
    expect(lines).toHaveLength(0);
    expect(notice).toMatch(/sin stock/i);
  });

  it("caps the quantity at the available stock and explains why", () => {
    const base = [line({ qty: 5, stock: 5 })];
    const { lines, notice } = addVariant(base, hit({ stock: 5 }));
    expect(lines[0].qty).toBe(5);
    expect(notice).toMatch(/solo hay 5/i);
  });
});

describe("editing lines", () => {
  it("changes the quantity within 1..stock", () => {
    const base = [line({ stock: 3 })];
    expect(setLineQty(base, "v1", 2)[0].qty).toBe(2);
    expect(setLineQty(base, "v1", 0)[0].qty).toBe(1);
    expect(setLineQty(base, "v1", 99)[0].qty).toBe(3);
    expect(setLineQty(base, "v1", Number.NaN)[0].qty).toBe(1);
  });

  it("keeps the typed price text and removes lines", () => {
    const base = [line(), line({ variantId: "v2", sku: "X" })];
    expect(setLinePrice(base, "v1", "150,5")[0].priceInput).toBe("150,5");
    expect(removeLine(base, "v1").map((l) => l.variantId)).toEqual(["v2"]);
  });
});

describe("totals (decimal, never float)", () => {
  it("sums quantity x final price without float drift", () => {
    const lines = [
      line({ qty: 3, priceInput: "0,10" }),
      line({ variantId: "v2", qty: 3, priceInput: "0,20" }),
    ];
    expect(lineTotal(lines[0])).toBe("0.30");
    expect(cartTotals(lines).total).toBe("0.90");
  });

  it("reports list total, discount and units", () => {
    const lines = [line({ qty: 2, priceInput: "170" }), line({ variantId: "v2", qty: 1 })];
    const totals = cartTotals(lines);
    expect(totals.listTotal).toBe("567.00");
    expect(totals.total).toBe("529.00");
    expect(totals.discount).toBe("38.00");
    expect(totals.units).toBe(3);
    expect(totals.valid).toBe(true);
  });

  it("handles a 30 line cart with large amounts", () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      line({ variantId: `v${i}`, qty: 7, listPrice: "1999.99", priceInput: "1999,99", stock: 50 }),
    );
    expect(cartTotals(lines).total).toBe("419997.90");
  });

  it("is invalid while a price cannot be read", () => {
    const totals = cartTotals([line({ priceInput: "abc" })]);
    expect(totals.valid).toBe(false);
    expect(totals.total).toBe("0.00");
  });
});

describe("line validation", () => {
  it("accepts a price at or above the floor", () => {
    expect(lineIssue(line({ priceInput: "151,20" }), "20")).toBeNull();
    expect(lineIssue(line({ priceInput: "300" }), "20")).toBeNull();
  });

  it("rejects a price below the floor with a Spanish hint", () => {
    const issue = lineIssue(line({ priceInput: "151,19" }), "20");
    expect(issue?.code).toBe("below_floor");
    expect(issue?.message).toContain("Bs 151,20");
    expect(issue?.message).toContain("20%");
  });

  it("has no floor for the superadmin (no limit passed)", () => {
    expect(lineIssue(line({ priceInput: "1" }), null)).toBeNull();
  });

  it("rejects empty, zero, negative and unreadable prices", () => {
    for (const bad of ["", "0", "0,00", "-5", "abc", "1,234"]) {
      expect(lineIssue(line({ priceInput: bad }), null)?.code, bad).toBe("price_invalid");
    }
  });

  it("rejects a quantity above the stock", () => {
    expect(lineIssue(line({ qty: 6, stock: 5 }), null)?.code).toBe("over_stock");
    expect(lineIssue(line({ qty: 1, stock: 0 }), null)?.code).toBe("out_of_stock");
  });
});
