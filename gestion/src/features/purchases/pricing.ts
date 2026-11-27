import Decimal from "decimal.js";
import { D, dec } from "@/lib/money";

/**
 * Sale-price suggestions. A SUGGESTION only: nothing here changes a price; applying one is
 * an explicit superadmin action (see actions.applyPriceAction).
 *
 *   margin = (price - cost) / price      (margin on the sale price)
 *   suggested price = cost / (1 - margin), rounded UP to a whole boliviano
 */
export function suggestPrice(costBs: string, targetMarginPct: string): string {
  const margin = dec(targetMarginPct);
  if (margin.lt(0) || margin.gte(100)) throw new RangeError("El margen objetivo debe estar entre 0 y 100");
  const raw = dec(costBs).div(new D(1).minus(margin.div(100)));
  return raw.toDecimalPlaces(0, Decimal.ROUND_CEIL).toFixed(2);
}

function exactMargin(price: string, costBs: string): Decimal | null {
  const p = dec(price);
  return p.lte(0) ? null : p.minus(costBs).div(p).times(100);
}

/** Margin in percent with one decimal ("19.8"), or null when there is no price to measure. */
export function marginPct(price: string, costBs: string): string | null {
  return exactMargin(price, costBs)?.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1) ?? null;
}

export interface PriceEvaluation {
  readonly currentMargin: string | null;
  readonly suggestedPrice: string;
  readonly suggestedMargin: string | null;
  /** Current margin (unrounded) is under the target: the warning shown to the superadmin. */
  readonly belowTarget: boolean;
}

export function evaluatePrice(input: {
  readonly currentPrice: string;
  readonly costBs: string;
  readonly targetMarginPct: string;
}): PriceEvaluation {
  const suggestedPrice = suggestPrice(input.costBs, input.targetMarginPct);
  const current = exactMargin(input.currentPrice, input.costBs);
  return {
    currentMargin: marginPct(input.currentPrice, input.costBs),
    suggestedPrice,
    suggestedMargin: marginPct(suggestedPrice, input.costBs),
    belowTarget: current === null || current.lt(input.targetMarginPct),
  };
}
