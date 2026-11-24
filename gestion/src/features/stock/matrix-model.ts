import { D, dec, toMoney } from "@/lib/money";

/** One variant of the stock query (superadmin: carries its costs). */
export interface MatrixVariant {
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly colorId: string;
  readonly color: string;
  readonly colorHex: string | null;
  readonly sizeId: string;
  readonly size: string;
  readonly sizeOrder: number;
  readonly sku: string;
  readonly qty: number;
  readonly price: string;
  readonly lastCostBs: string | null;
  readonly avgCostBs: string | null;
}

export interface MatrixCell {
  readonly sku: string;
  readonly qty: number;
  readonly lastCostBs: string | null;
  readonly avgCostBs: string | null;
}

export interface MatrixModel {
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly price: string;
  readonly sizes: readonly { id: string; label: string }[];
  readonly colors: readonly { id: string; name: string; hex: string | null; total: number }[];
  readonly cells: Readonly<Record<string, MatrixCell>>;
  readonly units: number;
  /** Stock valued at average cost, in Bs. */
  readonly valueBs: string;
}

export const cellKey = (colorId: string, sizeId: string): string => `${colorId}:${sizeId}`;

/** Groups variants into one color x size matrix per model (pure; input order does not matter). */
export function buildStockMatrix(variants: readonly MatrixVariant[]): MatrixModel[] {
  const byModel = new Map<string, MatrixVariant[]>();
  for (const variant of variants) byModel.set(variant.modelId, [...(byModel.get(variant.modelId) ?? []), variant]);

  return [...byModel.values()]
    .map((group) => {
      const sizes = [...new Map(group.map((v) => [v.sizeId, v])).values()]
        .sort((a, b) => a.sizeOrder - b.sizeOrder || a.size.localeCompare(b.size))
        .map((v) => ({ id: v.sizeId, label: v.size }));
      const colorTotals = new Map<string, number>();
      for (const v of group) colorTotals.set(v.colorId, (colorTotals.get(v.colorId) ?? 0) + v.qty);
      const colors = [...new Map(group.map((v) => [v.colorId, v])).values()]
        .sort((a, b) => a.color.localeCompare(b.color))
        .map((v) => ({ id: v.colorId, name: v.color, hex: v.colorHex, total: colorTotals.get(v.colorId) ?? 0 }));
      const cells = Object.fromEntries(
        group.map((v) => [
          cellKey(v.colorId, v.sizeId),
          { sku: v.sku, qty: v.qty, lastCostBs: v.lastCostBs, avgCostBs: v.avgCostBs },
        ]),
      );
      const value = group.reduce(
        (sum, v) => (v.avgCostBs === null ? sum : sum.plus(dec(v.avgCostBs).times(v.qty))),
        new D(0),
      );
      return {
        modelId: group[0].modelId,
        model: group[0].model,
        line: group[0].line,
        price: group[0].price,
        sizes,
        colors,
        cells,
        units: group.reduce((sum, v) => sum + v.qty, 0),
        valueBs: toMoney(value),
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model));
}
