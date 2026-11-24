import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { buildStockMatrix, type MatrixModel, type MatrixVariant } from "./matrix-model";

export interface StockMatrixOptions {
  readonly branchId?: string | null;
  readonly modelId?: string | null;
}

/**
 * Stock matrix with last / average cost per variant. SUPERADMIN ONLY: it joins variant_costs,
 * which sellers cannot read (they would get a permission error, never a row).
 */
export async function getStockMatrix(session: SessionPayload, options: StockMatrixOptions): Promise<MatrixModel[]> {
  if (session.role !== "superadmin") throw new Error("Solo el superadmin puede ver costos.");
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select m.id as model_id, m.name as model, l.name as line, c.id as color_id, c.name as color, c.hex,
              z.id as size_id, z.label as size, z.sort_order, v.sku, m.base_sale_price::text as price,
              coalesce(sum(sl.qty), 0)::int as qty,
              vc.last_cost_bs::text as last_cost, vc.avg_cost_bs::text as avg_cost
         from variants v
         join models m on m.id = v.model_id
         join product_lines l on l.id = m.line_id
         join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
         left join stock_levels sl on sl.variant_id = v.id and ($1::uuid is null or sl.branch_id = $1::uuid)
         left join variant_costs vc on vc.variant_id = v.id
        where v.active and m.active and ($2::uuid is null or m.id = $2::uuid)
        group by m.id, m.name, l.name, c.id, c.name, c.hex, z.id, z.label, z.sort_order, v.sku,
                 m.base_sale_price, vc.last_cost_bs, vc.avg_cost_bs`,
      [options.branchId ?? null, options.modelId ?? null],
    );
    const variants: MatrixVariant[] = rows.map((row) => ({
      modelId: row.model_id,
      model: row.model,
      line: row.line,
      colorId: row.color_id,
      color: row.color,
      colorHex: row.hex,
      sizeId: row.size_id,
      size: row.size,
      sizeOrder: row.sort_order,
      sku: row.sku,
      qty: row.qty,
      price: row.price,
      lastCostBs: row.last_cost,
      avgCostBs: row.avg_cost,
    }));
    return buildStockMatrix(variants);
  });
}
