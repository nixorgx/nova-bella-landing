import { dec, parseMoney, toMoney } from "@/lib/money";

export type ClosingStatus = "pending" | "balanced" | "short" | "over";

export interface ClosingResult {
  readonly expected: string;
  /** counted - expected; negative = money is missing. null until the count is readable. */
  readonly difference: string | null;
  readonly status: ClosingStatus;
}

export interface ExpectedCashInput {
  readonly openingAmount: string;
  /** Cash payments of the session's sales (voided ones excluded). */
  readonly cashSales: string;
  /** Cash collected (+) minus cash refunded (-) by exchanges that went through this session. */
  readonly cashExchangeNet?: string;
}

/** Expected cash in the drawer = opening float + cash sales + cash collected - cash refunded in exchanges. */
export function expectedCash(input: ExpectedCashInput): string {
  return toMoney(dec(input.openingAmount).plus(input.cashSales).plus(input.cashExchangeNet ?? "0"));
}

export function cashClosing(input: ExpectedCashInput & { readonly counted: string }): ClosingResult {
  const expected = expectedCash(input);
  const counted = parseMoney(input.counted);
  if (counted === null || dec(counted).isNegative()) return { expected, difference: null, status: "pending" };
  const difference = dec(counted).minus(expected);
  return {
    expected,
    difference: toMoney(difference),
    status: difference.isZero() ? "balanced" : difference.isNegative() ? "short" : "over",
  };
}
