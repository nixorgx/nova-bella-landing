"use client";

import { useCallback, useSyncExternalStore } from "react";
import { addLine, cartStore, countUnits, removeLine, setLineQty, type CartLines } from "./cart-store";

export interface UseCart {
  readonly lines: CartLines;
  readonly units: number;
  add(variantId: string, qty?: number): void;
  setQty(variantId: string, qty: number): void;
  remove(variantId: string): void;
  clear(): void;
}

export function useCart(): UseCart {
  const lines = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot, cartStore.getServerSnapshot);
  const add = useCallback((variantId: string, qty = 1) => cartStore.update((l) => addLine(l, variantId, qty)), []);
  const setQty = useCallback((variantId: string, qty: number) => cartStore.update((l) => setLineQty(l, variantId, qty)), []);
  const remove = useCallback((variantId: string) => cartStore.update((l) => removeLine(l, variantId)), []);
  const clear = useCallback(() => cartStore.clear(), []);
  return { lines, units: countUnits(lines), add, setQty, remove, clear };
}
