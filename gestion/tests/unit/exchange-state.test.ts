import { describe, expect, it } from "vitest";
import {
  buildPayload,
  EMPTY_DRAFT,
  isReady,
  selectedCount,
  setOverride,
  setQty,
  setReplacement,
  toggleLine,
  type DraftLine,
} from "@/features/exchanges/ui/exchange-state";

const lines = [
  { variantId: "11111111-1111-4111-8111-111111111111", remaining: 2 },
  { variantId: "22222222-2222-4222-8222-222222222222", remaining: 0 },
];
const replacement = { variantId: "33333333-3333-4333-8333-333333333333", label: "Alba Negro talla 39", price: "150.00", stock: 4 };

describe("exchange draft", () => {
  it("selects a line with quantity 1 and removes it again", () => {
    const on = toggleLine(EMPTY_DRAFT, lines[0].variantId);
    expect(on[lines[0].variantId]).toMatchObject({ qty: 1, replacement: null });
    expect(selectedCount(on)).toBe(1);
    expect(selectedCount(toggleLine(on, lines[0].variantId))).toBe(0);
  });

  it("keeps the quantity inside what can still be exchanged", () => {
    const on = toggleLine(EMPTY_DRAFT, lines[0].variantId);
    expect(setQty(on, lines[0].variantId, 5, 2)[lines[0].variantId].qty).toBe(2);
    expect(setQty(on, lines[0].variantId, 0, 2)[lines[0].variantId].qty).toBe(1);
    expect(setQty(on, lines[0].variantId, 2, 2)[lines[0].variantId].qty).toBe(2);
  });

  it("is immutable", () => {
    const on = toggleLine(EMPTY_DRAFT, lines[0].variantId);
    const next = setReplacement(on, lines[0].variantId, replacement);
    expect(on[lines[0].variantId].replacement).toBeNull();
    expect(next).not.toBe(on);
    expect(Object.isFrozen(EMPTY_DRAFT)).toBe(true);
  });

  it("is ready only when every selected line has a replacement", () => {
    const on = toggleLine(EMPTY_DRAFT, lines[0].variantId);
    expect(isReady(EMPTY_DRAFT)).toBe(false);
    expect(isReady(on)).toBe(false);
    expect(isReady(setReplacement(on, lines[0].variantId, replacement))).toBe(true);
  });

  it("builds the payload for the server with the optional manual difference", () => {
    const draft = setOverride(setReplacement(toggleLine(EMPTY_DRAFT, lines[0].variantId), lines[0].variantId, replacement), lines[0].variantId, " -10,50 ");
    expect(buildPayload("sale-id", draft)).toEqual({
      saleId: "sale-id",
      lines: [{ returnedVariantId: lines[0].variantId, newVariantId: replacement.variantId, qty: 1, priceDiffOverride: "-10,50" }],
    });
    const plain = setReplacement(toggleLine(EMPTY_DRAFT, lines[0].variantId), lines[0].variantId, replacement);
    expect(buildPayload("sale-id", plain).lines[0].priceDiffOverride).toBeUndefined();
  });

  it("drops lines without replacement from the payload", () => {
    const draft: Readonly<Record<string, DraftLine>> = toggleLine(EMPTY_DRAFT, lines[0].variantId);
    expect(buildPayload("s", draft).lines).toEqual([]);
  });
});
