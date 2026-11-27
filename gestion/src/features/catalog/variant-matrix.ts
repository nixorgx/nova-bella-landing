/** Upper bound for one generation, to keep the transaction and the preview fast. */
export const MAX_COMBINATIONS = 400;

export interface VariantPair {
  readonly colorId: string;
  readonly sizeId: string;
}

export interface MatrixPlan {
  readonly toCreate: readonly VariantPair[];
  readonly toSkip: readonly VariantPair[];
  readonly total: number;
}

function pairKey(pair: VariantPair): string {
  return `${pair.colorId}:${pair.sizeId}`;
}

/**
 * Cross product of the ticked colors and sizes, split into the pairs that still
 * have to be created and the ones that already exist for the model.
 */
export function planVariantMatrix(input: {
  readonly colorIds: readonly string[];
  readonly sizeIds: readonly string[];
  readonly existing: readonly VariantPair[];
}): MatrixPlan {
  const colors = [...new Set(input.colorIds)];
  const sizes = [...new Set(input.sizeIds)];
  const existing = new Set(input.existing.map(pairKey));

  const toCreate: VariantPair[] = [];
  const toSkip: VariantPair[] = [];
  for (const colorId of colors) {
    for (const sizeId of sizes) {
      const pair = { colorId, sizeId };
      (existing.has(pairKey(pair)) ? toSkip : toCreate).push(pair);
    }
  }
  return { toCreate, toSkip, total: toCreate.length + toSkip.length };
}
