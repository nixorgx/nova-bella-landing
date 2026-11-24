import { D, dec, toMoney } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/features/sales/payments";
import { eachDay, type DateRange } from "./period";

/** Average ticket, "0.00" when nothing was sold. */
export function ticketAverage(amount: string, count: number): string {
  return count <= 0 ? "0.00" : toMoney(dec(amount).div(count));
}

/** Percent change versus the previous period (null when there is no base to compare with). */
export function pctChange(current: string, previous: string): number | null {
  const base = dec(previous);
  if (base.isZero()) return null;
  return dec(current).minus(base).div(base).times(100).toDecimalPlaces(1).toNumber();
}

/** Margin over revenue as a one-decimal percent string (null without positive revenue). */
export function marginPct(revenue: string, cost: string): string | null {
  const gross = dec(revenue);
  if (gross.lte(0)) return null;
  return gross.minus(cost).div(gross).times(100).toDecimalPlaces(1).toFixed(1);
}

export interface ProfitInput {
  readonly salesRevenue: string;
  /** Net price differences collected (+) or refunded (-) in exchanges. */
  readonly exchangeDiff: string;
  readonly salesCost: string;
  /** Sum over exchanges of qty * (new unit cost - returned unit cost). */
  readonly exchangeCostDelta: string;
}

export interface ProfitResult {
  readonly revenue: string;
  readonly cost: string;
  readonly profit: string;
  readonly marginPct: string | null;
}

/**
 * Profit of a period = (sales + exchange differences) - (cost of sold pairs + cost swing of
 * exchanged pairs). Costs are the snapshots taken when the sale / exchange happened.
 */
export function profitOf(input: ProfitInput): ProfitResult {
  const revenue = toMoney(dec(input.salesRevenue).plus(input.exchangeDiff));
  const cost = toMoney(dec(input.salesCost).plus(input.exchangeCostDelta));
  return { revenue, cost, profit: toMoney(dec(revenue).minus(cost)), marginPct: marginPct(revenue, cost) };
}

export interface DailyPoint {
  readonly day: string;
  readonly total: string;
  readonly count: number;
}

/** One point per calendar day of the range; days without sales are zero (a chart needs the gaps). */
export function fillDailySeries(rows: readonly DailyPoint[], range: DateRange): DailyPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return eachDay(range.from, range.to).map((day) => byDay.get(day) ?? { day, total: "0.00", count: 0 });
}

export interface HeatCell {
  readonly model: string;
  readonly size: string;
  readonly sizeOrder: number;
  readonly units: number;
}

export interface Heatmap {
  readonly models: readonly { model: string; total: number; cells: Readonly<Record<string, number>> }[];
  readonly sizes: readonly { label: string; order: number; total: number }[];
  readonly max: number;
  readonly total: number;
}

/** Model x size grid of units sold: models by units desc, sizes ascending. Zero-unit rows are dropped. */
export function buildHeatmap(cells: readonly HeatCell[]): Heatmap {
  const used = cells.filter((cell) => cell.units > 0);
  const byModel = new Map<string, Record<string, number>>();
  const bySize = new Map<string, { label: string; order: number; total: number }>();
  for (const cell of used) {
    byModel.set(cell.model, { ...byModel.get(cell.model), [cell.size]: (byModel.get(cell.model)?.[cell.size] ?? 0) + cell.units });
    const size = bySize.get(cell.size) ?? { label: cell.size, order: cell.sizeOrder, total: 0 };
    bySize.set(cell.size, { ...size, total: size.total + cell.units });
  }
  const models = [...byModel.entries()]
    .map(([model, perSize]) => ({ model, cells: perSize, total: Object.values(perSize).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
  const sizes = [...bySize.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return {
    models,
    sizes,
    max: used.reduce((max, cell) => Math.max(max, cell.units), 0),
    total: used.reduce((sum, cell) => sum + cell.units, 0),
  };
}

/** 0..1 shade for a heat cell. Square-rooted so a few sales still show against a big seller. */
export function heatIntensity(units: number, max: number): number {
  if (units <= 0 || max <= 0) return 0;
  return Math.min(1, Math.sqrt(units / max));
}

export function rankTop<T>(rows: readonly T[], limit: number, value: (row: T) => number): T[] {
  return [...rows].sort((a, b) => value(b) - value(a)).slice(0, limit);
}

export interface MethodRow {
  readonly method: PaymentMethod;
  readonly sales: string;
  readonly exchanges: string;
  readonly net: string;
}

export function mergeByMethod(
  sales: Readonly<Record<PaymentMethod, string>>,
  exchanges: Readonly<Record<PaymentMethod, string>>,
): MethodRow[] {
  return PAYMENT_METHODS.map((method) => ({
    method,
    sales: toMoney(sales[method]),
    exchanges: toMoney(exchanges[method]),
    net: toMoney(dec(sales[method]).plus(exchanges[method])),
  }));
}

export const EMPTY_BY_METHOD: Readonly<Record<PaymentMethod, string>> = {
  efectivo: "0.00",
  qr: "0.00",
  transferencia: "0.00",
  tarjeta: "0.00",
};

export function sumByMethod(rows: readonly { method: PaymentMethod; amount: string }[]): Record<PaymentMethod, string> {
  const result: Record<PaymentMethod, string> = { ...EMPTY_BY_METHOD };
  for (const row of rows) result[row.method] = toMoney(new D(result[row.method]).plus(row.amount));
  return result;
}
