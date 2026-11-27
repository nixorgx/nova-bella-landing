import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { dec, parseMoney } from "@/lib/money";

export interface VariantCost {
  readonly sku: string;
  readonly color: string;
  readonly size: string;
  readonly lastCostBs: string;
  readonly avgCostBs: string;
}

export interface ModelCost {
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly currentPrice: string;
  /** Highest last cost among the model's variants: the conservative base for a price. */
  readonly lastCostBs: string;
  readonly avgCostBs: string;
  readonly variants: readonly VariantCost[];
}

/**
 * Costs per model (superadmin only: variant_costs is not readable by sellers). With a batch id,
 * only the models that arrived in that batch.
 */
export async function listModelCosts(session: SessionPayload, batchId?: string): Promise<ModelCost[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select m.id as model_id, m.name as model, l.name as line, m.base_sale_price::text as price,
              v.sku, c.name as color, z.label as size, z.sort_order,
              vc.last_cost_bs::text as last_cost, vc.avg_cost_bs::text as avg_cost
         from variant_costs vc
         join variants v on v.id = vc.variant_id
         join models m on m.id = v.model_id
         join product_lines l on l.id = m.line_id
         join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
        where ($1::uuid is null or v.id in (select variant_id from purchase_items where batch_id = $1::uuid))
        order by m.name, c.name, z.sort_order, v.sku`,
      [batchId ?? null],
    );
    const byModel = new Map<string, ModelCost>();
    for (const row of rows) {
      const variant: VariantCost = {
        sku: row.sku,
        color: row.color,
        size: row.size,
        lastCostBs: row.last_cost,
        avgCostBs: row.avg_cost,
      };
      const current = byModel.get(row.model_id);
      byModel.set(row.model_id, {
        modelId: row.model_id,
        model: row.model,
        line: row.line,
        currentPrice: row.price,
        lastCostBs: current && dec(current.lastCostBs).gte(row.last_cost) ? current.lastCostBs : row.last_cost,
        avgCostBs: current && dec(current.avgCostBs).gte(row.avg_cost) ? current.avgCostBs : row.avg_cost,
        variants: [...(current?.variants ?? []), variant],
      });
    }
    return [...byModel.values()];
  });
}

/** Changes a model's base sale price. Only ever called after an explicit confirmation. */
export async function applyModelPrice(session: SessionPayload, modelId: string, priceInput: string): Promise<string> {
  const price = parseMoney(priceInput);
  if (price === null || dec(price).lte(0) || dec(price).gt(99_999.99)) {
    throw new RangeError("Ingrese un precio válido en Bs (ej. 253,00).");
  }
  return withUser(session, async (client) => {
    const { rowCount } = await client.query("update models set base_sale_price = $2 where id = $1", [modelId, price]);
    if (!rowCount) throw new RangeError("El modelo no existe.");
    return price;
  });
}
