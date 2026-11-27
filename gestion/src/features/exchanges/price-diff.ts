import { D, dec, toMoney } from "@/lib/money";

/**
 * Price difference of one exchange line, exactly as create_exchange computes it:
 * (list price of the new pair - price actually paid for the returned one) * qty, rounded half up.
 */
export function computeExchangeDiff(input: { paidUnit: string; newPrice: string; qty: number }): string {
  return toMoney(dec(input.newPrice).minus(input.paidUnit).times(input.qty));
}

export type SettlementDirection = "cobrar" | "devolver" | "ninguna";

export function settlementOf(net: string): { direction: SettlementDirection; amount: string } {
  const value = dec(net);
  if (value.isZero()) return { direction: "ninguna", amount: "0.00" };
  return value.gt(0)
    ? { direction: "cobrar", amount: toMoney(value) }
    : { direction: "devolver", amount: toMoney(value.abs()) };
}

export function netOfLines(diffs: readonly string[]): string {
  return toMoney(diffs.reduce((sum, diff) => sum.plus(diff), new D(0)));
}

/**
 * Bounds the superadmin may use when overriding a line's difference (mirrors create_exchange):
 * never refund more than was paid, never charge more than the new pair's list price.
 */
export function checkOverride(input: { diff: string; paidUnit: string; newPrice: string; qty: number }): string | null {
  const value = dec(input.diff);
  if (!value.equals(value.toDecimalPlaces(2))) return "La diferencia admite 2 decimales.";
  const floor = dec(input.paidUnit).times(input.qty).toDecimalPlaces(2).negated();
  const ceiling = dec(input.newPrice).times(input.qty).toDecimalPlaces(2);
  if (value.lt(floor) || value.gt(ceiling)) {
    return `La diferencia está fuera de los límites permitidos (de ${toMoney(floor)} a ${toMoney(ceiling)}).`;
  }
  return null;
}
