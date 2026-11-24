import Decimal from "decimal.js";

/** Decimal constructor with fixed precision and half-up rounding (shared by costing). */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type DecimalValue = Decimal.Value;

/** Builds a Decimal, converting library errors into a RangeError with a clear message. */
export function dec(value: DecimalValue): Decimal {
  try {
    return new D(value);
  } catch {
    throw new RangeError(`Valor numerico invalido: ${String(value)}`);
  }
}

function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Normalizes any numeric value to a 2-decimal string (half up). */
export function toMoney(value: DecimalValue): string {
  return roundMoney(dec(value)).toFixed(2);
}

export function addMoney(a: DecimalValue, b: DecimalValue): string {
  return toMoney(dec(a).plus(dec(b)));
}

export function subMoney(a: DecimalValue, b: DecimalValue): string {
  return toMoney(dec(a).minus(dec(b)));
}

export function mulMoney(amount: DecimalValue, factor: DecimalValue): string {
  return toMoney(dec(amount).times(dec(factor)));
}

export function sumMoney(values: readonly DecimalValue[]): string {
  return toMoney(values.reduce<Decimal>((total, value) => total.plus(dec(value)), new D(0)));
}

export function moneyEquals(a: DecimalValue, b: DecimalValue): boolean {
  return roundMoney(dec(a)).equals(roundMoney(dec(b)));
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Formats an amount as Bolivian bolivianos: "Bs 1.234,50". */
export function formatBs(value: DecimalValue | null | undefined): string {
  if (value === null || value === undefined) return "-";
  let rounded: Decimal;
  try {
    rounded = roundMoney(new D(value));
  } catch {
    return "-";
  }
  if (!rounded.isFinite()) return "-";
  const [whole, cents] = rounded.abs().toFixed(2).split(".");
  const sign = rounded.isNegative() && !rounded.isZero() ? "-" : "";
  return `${sign}Bs ${groupThousands(whole)},${cents}`;
}

/**
 * Normalizes user-typed decimals ("12,50", "1.234,50", "1,234.50", "Bs 15") to a plain
 * "-?123.45" string with at most `maxDecimals` decimals, or null when it is not a number.
 */
export function normalizeDecimalText(input: string, maxDecimals: number): string | null {
  const text = input.replace(/^\s*bs\.?/i, "").replace(/\s+/g, "");
  if (!/^-?[\d.,]+$/.test(text)) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  let normalized = text;

  if (lastDot >= 0 && lastComma >= 0) {
    const groupChar = lastDot > lastComma ? "," : ".";
    normalized = text.split(groupChar).join("");
  } else if (decimalAt >= 0 && text.split(text[decimalAt]).length > 2) {
    return null;
  }
  normalized = normalized.replace(",", ".");

  const pattern = new RegExp(`^-?\\d+(\\.\\d{1,${maxDecimals}})?$`);
  return pattern.test(normalized) ? normalized : null;
}

/**
 * Parses user-typed money ("12,50", "1.234,50", "1,234.50", "Bs 15") into a
 * 2-decimal string. Returns null when the text is not a valid amount.
 */
export function parseMoney(input: string): string | null {
  const normalized = normalizeDecimalText(input, 2);
  return normalized === null ? null : toMoney(normalized);
}

export function isValidMoneyInput(input: string): boolean {
  return parseMoney(input) !== null;
}
