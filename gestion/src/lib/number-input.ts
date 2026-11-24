import { dec, normalizeDecimalText } from "./money";

const RATE_DECIMALS = 4;

/** Exchange rate typed by a person ("6,96" or "10.5"): > 0, up to 4 decimals. Returns a plain decimal string. */
export function parseRate(input: string): string | null {
  const normalized = normalizeDecimalText(input, RATE_DECIMALS);
  return normalized !== null && dec(normalized).gt(0) ? normalized : null;
}

/** Whole number within [min, max] ("7"), or null. */
export function parseInteger(input: string, min: number, max: number): number | null {
  const text = input.trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

/** "6.9600" -> "6,96" (comma decimal, no trailing zeros) for rate inputs shown to people. */
export function formatRateInput(rate: string): string {
  const trimmed = rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
  return trimmed.replace(".", ",");
}
