import { toSession, type AuthUser } from "@/lib/auth/guards";
import { withUser } from "@/lib/db";
import { buildPage, clampPage, type Page, type PageRequest } from "@/lib/pagination";

export interface StockRow {
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly size: string;
  readonly qty: number;
  readonly price: string;
}

export { LOW_STOCK_THRESHOLD, stockState, type StockState } from "@/lib/stock-state";

/**
 * One page of the stock visible to the caller, plus the real total. RLS limits a seller
 * to their own branch and the query never touches cost tables, so no cost data can leak
 * from here. Ordering ends in the SKU so pages are stable and never overlap.
 */
export async function listStock(user: AuthUser, request: PageRequest): Promise<Page<StockRow>> {
  return withUser(toSession(user), async (client) => {
    const counted = await client.query<{ total: number }>(
      "select count(distinct variant_id)::int as total from stock_levels",
    );
    const total = counted.rows[0].total;
    const page = clampPage(request.page, total, request.pageSize);

    const { rows } = await client.query(
      `select v.sku, m.name as model, c.name as color, s.label as size,
              sum(sl.qty)::int as qty, m.base_sale_price as price
         from stock_levels sl
         join variants v on v.id = sl.variant_id
         join models m on m.id = v.model_id
         join colors c on c.id = v.color_id
         join sizes s on s.id = v.size_id
        group by v.id, v.sku, m.name, c.name, s.label, s.sort_order, m.base_sale_price
        order by m.name, c.name, s.sort_order, v.sku
        limit $1 offset $2`,
      [request.pageSize, (page - 1) * request.pageSize],
    );
    const mapped: StockRow[] = rows.map((row) => ({
      sku: row.sku,
      model: row.model,
      color: row.color,
      size: row.size,
      qty: row.qty,
      price: row.price,
    }));
    return buildPage(mapped, total, { page, pageSize: request.pageSize });
  });
}
