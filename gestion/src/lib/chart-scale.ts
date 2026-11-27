import { startOfWeek } from "@/features/reports/period";
import { toMoney } from "@/lib/money";

export const MAX_BARS = 62;

/** Top of the y axis: the next "clean" step (1, 1.5, 2, 3, 5, 7.5, 10 x power of ten) above the data. */
export function niceMax(max: number): number {
  if (max <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const steps = [1, 1.5, 2, 3, 5, 7.5, 10];
  const step = steps.find((candidate) => candidate * magnitude >= max) ?? 10;
  return step * magnitude;
}

/** Gridline values from zero to the nice max, always on round numbers (halves or thirds of the top). */
export function yTicks(max: number): number[] {
  const top = niceMax(max);
  const lead = top / 10 ** Math.floor(Math.log10(top));
  const parts = [1.5, 3, 7.5].includes(lead) ? 3 : 2;
  return Array.from({ length: parts + 1 }, (_, i) => (top / parts) * i);
}

/** Axis label: full under 10,000 ("1.500"), compact above ("12 mil", "1,5 M"). */
export function compactBs(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")} M`;
  if (abs >= 10_000) return `${Math.round(value / 1000)} mil`;
  return new Intl.NumberFormat("es-BO").format(Math.round(value));
}

export interface Bucket {
  readonly key: string;
  readonly label: string;
  readonly total: string;
  readonly count: number;
}

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

export function shortDay(key: string): string {
  return `${Number(key.slice(8, 10))} ${SHORT_MONTHS[Number(key.slice(5, 7)) - 1]}`;
}

/** One bar per day; past MAX_BARS days the bars become weeks so a year-long range stays legible. */
export function bucketSeries(points: readonly { day: string; total: string; count: number }[]): Bucket[] {
  if (points.length <= MAX_BARS) {
    return points.map((p) => ({ key: p.day, label: shortDay(p.day), total: p.total, count: p.count }));
  }
  const weeks = new Map<string, { total: number; count: number }>();
  for (const point of points) {
    const week = startOfWeek(point.day);
    const current = weeks.get(week) ?? { total: 0, count: 0 };
    weeks.set(week, { total: current.total + Number(point.total), count: current.count + point.count });
  }
  return [...weeks.entries()].map(([week, value]) => ({
    key: week,
    label: `Sem. ${shortDay(week)}`,
    total: toMoney(value.total),
    count: value.count,
  }));
}
