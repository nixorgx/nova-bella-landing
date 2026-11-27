export const LOW_STOCK_THRESHOLD = 2;

export type StockState = "ok" | "low" | "out";

export function stockState(qty: number): StockState {
  if (qty <= 0) return "out";
  return qty <= LOW_STOCK_THRESHOLD ? "low" : "ok";
}

export const STOCK_LABEL: Readonly<Record<StockState, string>> = {
  ok: "Disponible",
  low: "Stock bajo",
  out: "Agotado",
};
