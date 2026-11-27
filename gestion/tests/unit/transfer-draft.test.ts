import { describe, expect, it } from "vitest";
import type { VariantHit } from "@/features/catalog/types";
import { addLine, dropLine, lineError, parseQty, patchQty, summarize } from "@/features/transfers/draft";
import { transferPayloadSchema } from "@/features/transfers/schemas";

const hit = (id: string, stock: number): VariantHit => ({
  variantId: id,
  sku: `SKU-${id}`,
  barcode: null,
  modelId: "m",
  model: "Alba",
  line: "Dama",
  color: "Negro",
  colorHex: "#000000",
  size: "38",
  price: "100.00",
  stock,
  active: true,
  modelActive: true,
});

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const X = "33333333-3333-4333-8333-333333333333";
const Y = "44444444-4444-4444-8444-444444444444";

describe("transfer draft", () => {
  it("parses quantities strictly", () => {
    expect(parseQty("3")).toBe(3);
    expect(parseQty(" 12 ")).toBe(12);
    for (const bad of ["", "0", "-1", "1.5", "1,5", "abc", "1000000", "100001"]) expect(parseQty(bad)).toBeNull();
  });

  it("adds a repeated variant as one more unit instead of a duplicate row, without mutating", () => {
    const first = addLine([], hit(A, 5));
    const second = addLine(first, hit(A, 5));
    expect(first[0].qtyInput).toBe("1");
    expect(second).toHaveLength(1);
    expect(second[0].qtyInput).toBe("2");
  });

  it("flags quantities above the origin stock and accepts the exact stock", () => {
    const lines = patchQty(addLine([], hit(A, 3)), A, "4");
    expect(lineError(lines[0])).toContain("Solo hay 3");
    expect(lineError(patchQty(lines, A, "3")[0])).toBeNull();
    expect(lineError(patchQty(addLine([], hit(B, 0)), B, "1")[0])).toContain("No hay stock");
    expect(lineError(patchQty(lines, A, "x")[0])).toContain("entera");
  });

  it("summarizes products and units and is ready only when every line is valid", () => {
    let lines = addLine(addLine([], hit(A, 5)), hit(B, 2));
    lines = patchQty(lines, A, "3");
    expect(summarize(lines)).toEqual({ products: 2, units: 4, ready: true });
    expect(summarize(patchQty(lines, B, "9")).ready).toBe(false);
    expect(summarize([]).ready).toBe(false);
    expect(dropLine(lines, A)).toHaveLength(1);
  });
});

describe("transferPayloadSchema", () => {
  const base = { fromBranchId: X, toBranchId: Y, note: "  reposición ", items: [{ variantId: A, qtyInput: "2" }] };

  it("accepts a valid payload and normalizes qty and note", () => {
    const parsed = transferPayloadSchema.parse(base);
    expect(parsed.items[0].qtyInput).toBe(2);
    expect(parsed.note).toBe("reposición");
  });

  it.each([
    ["same branch", { ...base, toBranchId: X }],
    ["no items", { ...base, items: [] }],
    ["duplicate variant", { ...base, items: [{ variantId: A, qtyInput: "1" }, { variantId: A, qtyInput: "1" }] }],
    ["bad qty", { ...base, items: [{ variantId: A, qtyInput: "0" }] }],
    ["bad uuid", { ...base, fromBranchId: "x" }],
    ["long note", { ...base, note: "x".repeat(301) }],
  ])("rejects %s", (_name, payload) => {
    expect(transferPayloadSchema.safeParse(payload).success).toBe(false);
  });
});
