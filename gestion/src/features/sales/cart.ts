import Decimal from "decimal.js";
import type { VariantHit } from "@/features/catalog/types";
import { D, dec, formatBs, parseMoney, toMoney } from "@/lib/money";

/**
 * Pure cart model for the POS. Everything is immutable (functions return new arrays) and
 * all money goes through decimal.js: no floats, a single half-up rounding per amount.
 * Sellers' data only: list price and the price actually charged, never a cost.
 */
export interface CartLine {
  readonly variantId: string;
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly colorHex: string | null;
  readonly size: string;
  readonly listPrice: string;
  readonly stock: number;
  readonly qty: number;
  /** What the seller typed ("150,50"); parsed on demand so half-typed text never throws. */
  readonly priceInput: string;
}

export type LineIssueCode = "price_invalid" | "below_floor" | "over_stock" | "out_of_stock";

export interface LineIssue {
  readonly code: LineIssueCode;
  readonly message: string;
}

export interface CartTotals {
  readonly units: number;
  readonly listTotal: string;
  readonly total: string;
  readonly discount: string;
  readonly valid: boolean;
}

const MAX_QTY = 999;

/** Lowest price a seller may charge: mirrors round(list * (1 - pct/100), 2) in create_sale. */
export function discountFloor(listPrice: string, maxDiscountPct: string | null): string | null {
  if (maxDiscountPct === null || maxDiscountPct === "") return null;
  const factor = new D(1).minus(dec(maxDiscountPct).div(100));
  return dec(listPrice).times(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Final unit price as a canonical string, or null when the typed text is not a price > 0. */
export function linePrice(line: CartLine): string | null {
  const parsed = parseMoney(line.priceInput);
  return parsed !== null && dec(parsed).gt(0) ? parsed : null;
}

export function lineTotal(line: CartLine): string {
  const price = linePrice(line);
  return price === null ? "0.00" : toMoney(dec(price).times(line.qty));
}

function describe(line: CartLine): string {
  return `${line.model} ${line.color} ${line.size}`;
}

export function lineIssue(line: CartLine, maxDiscountPct: string | null): LineIssue | null {
  if (line.stock <= 0) {
    return { code: "out_of_stock", message: `${describe(line)} no tiene stock disponible.` };
  }
  if (line.qty > line.stock) {
    return { code: "over_stock", message: `Solo hay ${line.stock} de ${describe(line)} en stock.` };
  }
  const price = linePrice(line);
  if (price === null) {
    return { code: "price_invalid", message: "Ingrese un precio mayor a cero (ej. 150,50)." };
  }
  const floor = discountFloor(line.listPrice, maxDiscountPct);
  if (floor !== null && dec(price).lt(floor)) {
    return {
      code: "below_floor",
      message: `El precio mínimo es ${formatBs(floor)} (descuento máximo ${maxDiscountPct}%).`,
    };
  }
  return null;
}

export function cartTotals(lines: readonly CartLine[]): CartTotals {
  let listTotal = new D(0);
  let total = new D(0);
  let units = 0;
  let valid = lines.length > 0;
  for (const line of lines) {
    const price = linePrice(line);
    if (price === null) valid = false;
    units += line.qty;
    listTotal = listTotal.plus(dec(line.listPrice).times(line.qty));
    if (price !== null) total = total.plus(dec(price).times(line.qty));
  }
  return {
    units,
    listTotal: toMoney(listTotal),
    total: toMoney(total),
    discount: toMoney(listTotal.minus(total)),
    valid,
  };
}

export interface AddResult {
  readonly lines: readonly CartLine[];
  readonly notice?: string;
}

function lineFromHit(hit: VariantHit): CartLine {
  return {
    variantId: hit.variantId,
    sku: hit.sku,
    model: hit.model,
    color: hit.color,
    colorHex: hit.colorHex,
    size: hit.size,
    listPrice: hit.price,
    stock: hit.stock,
    qty: 1,
    priceInput: hit.price,
  };
}

/** Scan / pick: new line, or +1 on the existing one, never above the stock on hand. */
export function addVariant(lines: readonly CartLine[], hit: VariantHit): AddResult {
  const label = `${hit.model} ${hit.color} ${hit.size}`;
  if (hit.stock <= 0) return { lines, notice: `${label} está sin stock en esta sucursal.` };

  const existing = lines.find((line) => line.variantId === hit.variantId);
  if (!existing) return { lines: [...lines, lineFromHit(hit)] };
  if (existing.qty >= hit.stock) {
    return { lines, notice: `Solo hay ${hit.stock} de ${label} en stock.` };
  }
  return {
    lines: lines.map((line) =>
      line.variantId === hit.variantId ? { ...line, qty: line.qty + 1, stock: hit.stock } : line,
    ),
  };
}

export function setLineQty(lines: readonly CartLine[], variantId: string, qty: number): CartLine[] {
  return lines.map((line) => {
    if (line.variantId !== variantId) return line;
    const wanted = Number.isFinite(qty) ? Math.trunc(qty) : 1;
    const ceiling = Math.max(1, Math.min(line.stock, MAX_QTY));
    return { ...line, qty: Math.min(Math.max(wanted, 1), ceiling) };
  });
}

export function setLinePrice(lines: readonly CartLine[], variantId: string, priceInput: string): CartLine[] {
  return lines.map((line) => (line.variantId === variantId ? { ...line, priceInput } : line));
}

export function removeLine(lines: readonly CartLine[], variantId: string): CartLine[] {
  return lines.filter((line) => line.variantId !== variantId);
}

/** Discount of a line against its list price, in percent (0 when none or unreadable). */
export function linePercentOff(line: CartLine): number {
  const price = linePrice(line);
  const list = dec(line.listPrice);
  if (price === null || list.lte(0) || dec(price).gte(list)) return 0;
  return list.minus(price).div(list).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}
