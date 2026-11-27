import { todayKey } from "@/lib/format";
import { dateParam, one } from "@/lib/search-params";

export type PeriodKind = "hoy" | "semana" | "mes" | "rango";

export interface DateRange {
  /** YYYY-MM-DD, inclusive, La Paz calendar day. */
  readonly from: string;
  readonly to: string;
}

export interface ResolvedPeriod extends DateRange {
  readonly kind: PeriodKind;
  readonly label: string;
}

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

const toMs = (key: string): number => Date.parse(`${key}T00:00:00Z`);
const toKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (key: string, days: number): string => toKey(toMs(key) + days * DAY_MS);

/** Monday of the week that contains `key` (weeks run Monday to Sunday). */
export function startOfWeek(key: string): string {
  const weekday = new Date(toMs(key)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((weekday + 6) % 7));
}

export const daysInRange = (range: DateRange): number => Math.round((toMs(range.to) - toMs(range.from)) / DAY_MS) + 1;

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

const displayDate = (key: string): string => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

function monthLabel(key: string): string {
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

function customRange(desde: string | undefined, hasta: string | undefined, today: string): DateRange | null {
  if (!desde && !hasta) return null;
  const a = desde ?? (hasta as string);
  const b = hasta ?? today;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export interface PeriodParams {
  readonly periodo?: string | string[];
  readonly desde?: string | string[];
  readonly hasta?: string | string[];
}

/**
 * Turns the URL parameters into a concrete, always valid range. Bad input never throws: it
 * falls back to the month so a shared link with garbage still renders something sensible.
 */
export function resolvePeriod(params: PeriodParams, today: string = todayKey()): ResolvedPeriod {
  const kind = one(params.periodo);
  if (kind === "hoy") return { kind: "hoy", from: today, to: today, label: "Hoy" };
  if (kind === "semana") return { kind: "semana", from: startOfWeek(today), to: today, label: "Esta semana" };
  if (kind === "rango") {
    const range = customRange(dateParam(params.desde), dateParam(params.hasta), today);
    if (range) {
      const from = daysInRange(range) > MAX_RANGE_DAYS ? addDays(range.to, -(MAX_RANGE_DAYS - 1)) : range.from;
      return { kind: "rango", from, to: range.to, label: `${displayDate(from)} al ${displayDate(range.to)}` };
    }
  }
  return { kind: "mes", from: `${today.slice(0, 7)}-01`, to: today, label: `Este mes (${monthLabel(today)})` };
}

export interface MonthSpan extends DateRange {
  /** Last day of that whole month (for "mes anterior completo"). */
  readonly fullTo: string;
}

/** Previous calendar month, cut at the same day number as `today` (fair month-to-date comparison). */
export function previousMonthSpan(today: string): MonthSpan {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const fullTo = addDays(firstOfMonth, -1);
  const from = `${fullTo.slice(0, 7)}-01`;
  const sameDay = `${fullTo.slice(0, 7)}-${today.slice(8, 10)}`;
  return { from, to: sameDay < fullTo ? sameDay : fullTo, fullTo };
}

/** The period of the same length that ends the day before `range` starts (for "vs período anterior"). */
export function previousRange(range: DateRange): DateRange {
  const length = daysInRange(range);
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}
