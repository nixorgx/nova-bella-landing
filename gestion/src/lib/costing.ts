import type Decimal from "decimal.js";
import { D, dec, type DecimalValue } from "./money";

/**
 * Landed cost per unit in Bs. PURE mirror of the SQL function landed_cost_bs():
 *
 *   usd * (split/100 * rate70 + (1 - split/100) * rate30) + freightBs / totalUnits
 *
 * Rounded half-up to 2 decimals exactly once, at the end.
 */
export interface LandedCostInput {
  readonly unitCostUsd: DecimalValue;
  readonly rate70: DecimalValue;
  readonly rate30: DecimalValue;
  readonly splitPct?: DecimalValue;
  readonly freightBs?: DecimalValue;
  readonly totalUnits: number;
}

export const DEFAULT_SPLIT_PCT = 70;

function assertInputs(
  usd: Decimal,
  rate70: Decimal,
  rate30: Decimal,
  split: Decimal,
  freight: Decimal,
  totalUnits: number,
): void {
  if (usd.isNegative()) throw new RangeError("El costo en USD no puede ser negativo");
  if (!rate70.gt(0) || !rate30.gt(0)) {
    throw new RangeError("Los tipos de cambio deben ser mayores a cero");
  }
  if (split.lt(0) || split.gt(100)) {
    throw new RangeError("El porcentaje de division debe estar entre 0 y 100");
  }
  if (freight.isNegative()) throw new RangeError("El flete no puede ser negativo");
  if (!Number.isInteger(totalUnits) || totalUnits <= 0) {
    throw new RangeError("El total de unidades debe ser un entero mayor a cero");
  }
}

export function calculateLandedCost(input: LandedCostInput): Decimal {
  const usd = dec(input.unitCostUsd);
  const rate70 = dec(input.rate70);
  const rate30 = dec(input.rate30);
  const split = dec(input.splitPct ?? DEFAULT_SPLIT_PCT);
  const freight = dec(input.freightBs ?? 0);
  assertInputs(usd, rate70, rate30, split, freight, input.totalUnits);

  const share70 = split.div(100);
  const blendedRate = share70.times(rate70).plus(new D(1).minus(share70).times(rate30));
  const freightPerUnit = freight.div(input.totalUnits);

  return usd.times(blendedRate).plus(freightPerUnit).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export interface BatchItemInput {
  readonly variantId: string;
  readonly qty: number;
  readonly unitCostUsd: DecimalValue;
}

export interface BatchCostInput {
  readonly rate70: DecimalValue;
  readonly rate30: DecimalValue;
  readonly splitPct?: DecimalValue;
  readonly freightBs?: DecimalValue;
  readonly items: readonly BatchItemInput[];
}

export interface BatchItemCost extends BatchItemInput {
  readonly unitCostBsLanded: Decimal;
  readonly lineTotalBs: Decimal;
}

export interface BatchCost {
  readonly items: readonly BatchItemCost[];
  readonly totalUnits: number;
  readonly totalBs: Decimal;
}

/** Live preview of a whole batch (same numbers create_purchase_batch will store). */
export function calculateBatchCosts(input: BatchCostInput): BatchCost {
  if (input.items.length === 0) throw new RangeError("El lote debe tener al menos un item");
  if (input.items.some((item) => !Number.isInteger(item.qty) || item.qty <= 0)) {
    throw new RangeError("Cada item debe tener una cantidad entera mayor a cero");
  }
  const totalUnits = input.items.reduce((sum, item) => sum + item.qty, 0);

  const items = input.items.map((item) => {
    const unitCostBsLanded = calculateLandedCost({
      unitCostUsd: item.unitCostUsd,
      rate70: input.rate70,
      rate30: input.rate30,
      splitPct: input.splitPct,
      freightBs: input.freightBs,
      totalUnits,
    });
    return { ...item, unitCostBsLanded, lineTotalBs: unitCostBsLanded.times(item.qty) };
  });

  const totalBs = items.reduce<Decimal>((sum, item) => sum.plus(item.lineTotalBs), new D(0));
  return { items, totalUnits, totalBs };
}
