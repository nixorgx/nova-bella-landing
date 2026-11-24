import type { VariantHit } from "@/features/catalog/types";
import type { DraftItem } from "../form-math";

/** A draft row plus what the screen needs to describe it (never sent to the server). */
export interface BatchItemState extends DraftItem {
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly colorHex: string | null;
  readonly size: string;
  readonly stock: number;
}

export function itemFromHit(hit: VariantHit): BatchItemState {
  return {
    variantId: hit.variantId,
    qtyInput: "1",
    costInput: "",
    sku: hit.sku,
    model: hit.model,
    color: hit.color,
    colorHex: hit.colorHex,
    size: hit.size,
    stock: hit.stock,
  };
}

/** Picking a variant already in the batch adds one unit instead of a duplicate row. */
export function addItem(items: readonly BatchItemState[], hit: VariantHit): BatchItemState[] {
  const existing = items.find((item) => item.variantId === hit.variantId);
  if (!existing) return [...items, itemFromHit(hit)];
  return items.map((item) =>
    item.variantId === hit.variantId
      ? { ...item, qtyInput: String((Number.parseInt(item.qtyInput, 10) || 0) + 1) }
      : item,
  );
}

export function patchItem(
  items: readonly BatchItemState[],
  variantId: string,
  patch: Partial<Pick<BatchItemState, "qtyInput" | "costInput">>,
): BatchItemState[] {
  return items.map((item) => (item.variantId === variantId ? { ...item, ...patch } : item));
}

export function dropItem(items: readonly BatchItemState[], variantId: string): BatchItemState[] {
  return items.filter((item) => item.variantId !== variantId);
}
