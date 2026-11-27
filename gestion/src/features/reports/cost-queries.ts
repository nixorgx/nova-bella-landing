import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { subMoney, toMoney } from "@/lib/money";
import { marginPct, profitOf, type ProfitResult } from "./aggregate";
import { movementLinesSql } from "./movement-sql";
import { inRangeSql, ownerSql, scopeValues, type ReportScope } from "./scope";

/*
 * SUPERADMIN-ONLY reports: cost, margin and profit.
 *
 * Cost basis (documented choice): the cost of a sold pair is the weighted-average landed cost
 * (variant_costs.avg_cost_bs) AT THE MOMENT OF THE SALE, frozen in sale_item_costs by a trigger.
 * Exchanges freeze the cost of the returned and the replacement pair the same way (exchange_costs).
 * Later purchases therefore never rewrite the profit of past periods. Sales that existed before
 * migration 015 were backfilled with the average at migration time.
 */

function assertSuperadmin(session: SessionPayload): void {
  if (session.role !== "superadmin") throw new Error("Solo el superadmin puede ver costos y utilidades.");
}

export interface ProfitSummary extends ProfitResult {
  readonly linesWithoutCost: number;
}

export async function getProfitSummary(session: SessionPayload, scope: ReportScope): Promise<ProfitSummary> {
  assertSuperadmin(session);
  const values = scopeValues(scope);
  return withUser(session, async (client) => {
    const sales = await client.query<{ revenue: string; cost: string; missing: number }>(
      `select coalesce(sum(si.qty * si.final_price), 0)::text as revenue,
              coalesce(sum(si.qty * coalesce(sic.unit_cost_bs, 0)), 0)::text as cost,
              count(*) filter (where sic.sale_item_id is null)::int as missing
         from sale_items si join sales s on s.id = si.sale_id
         left join sale_item_costs sic on sic.sale_item_id = si.id
        where s.status = 'completed' and ${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}`,
      values,
    );
    const exchanges = await client.query<{ diff: string; delta: string }>(
      `select coalesce(sum(e.price_diff), 0)::text as diff,
              coalesce(sum(e.qty * (coalesce(ec.new_unit_cost_bs, 0) - coalesce(ec.returned_unit_cost_bs, 0))), 0)::text as delta
         from exchanges e join sales s on s.id = e.original_sale_id
         left join exchange_costs ec on ec.exchange_id = e.id
        where s.status = 'completed' and ${inRangeSql("e.created_at")} and ${ownerSql("e.branch_id", "s.seller_id")}`,
      values,
    );
    const profit = profitOf({
      salesRevenue: sales.rows[0].revenue,
      exchangeDiff: exchanges.rows[0].diff,
      salesCost: sales.rows[0].cost,
      exchangeCostDelta: exchanges.rows[0].delta,
    });
    return { ...profit, linesWithoutCost: sales.rows[0].missing };
  });
}

export interface ModelProfitRow {
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly units: number;
  readonly revenue: string;
  readonly cost: string;
  readonly profit: string;
  readonly marginPct: string | null;
}

export async function getProfitByModel(session: SessionPayload, scope: ReportScope): Promise<ModelProfitRow[]> {
  assertSuperadmin(session);
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `with lines as (${movementLinesSql(true)})
       select m.id as model_id, m.name as model, pl.name as line, sum(l.units)::int as units,
              sum(l.revenue)::text as revenue, sum(l.cost)::text as cost
         from lines l join variants v on v.id = l.variant_id join models m on m.id = v.model_id
         join product_lines pl on pl.id = m.line_id
        group by m.id, m.name, pl.name
       having sum(l.units) <> 0 or sum(l.revenue) <> 0
        order by sum(l.revenue) - sum(l.cost) desc`,
      scopeValues(scope),
    );
    return rows.map((row) => ({
      modelId: row.model_id,
      model: row.model,
      line: row.line,
      units: row.units,
      revenue: toMoney(row.revenue),
      cost: toMoney(row.cost),
      profit: subMoney(row.revenue, row.cost),
      marginPct: marginPct(row.revenue, row.cost),
    }));
  });
}

export interface InventoryValue {
  readonly units: number;
  readonly value: string;
  readonly variantsWithoutCost: number;
}

/** Stock valued at the current average cost, per branch filter. */
export async function getInventoryValue(session: SessionPayload, branchId: string | null): Promise<InventoryValue> {
  assertSuperadmin(session);
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select coalesce(sum(sl.qty), 0)::int as units,
              coalesce(sum(sl.qty * vc.avg_cost_bs), 0)::text as value,
              count(*) filter (where vc.variant_id is null and sl.qty > 0)::int as missing
         from stock_levels sl left join variant_costs vc on vc.variant_id = sl.variant_id
        where ($1::uuid is null or sl.branch_id = $1::uuid)`,
      [branchId],
    );
    return { units: rows[0].units, value: toMoney(rows[0].value), variantsWithoutCost: rows[0].missing };
  });
}

export interface StockCostRow {
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly size: string;
  readonly qty: number;
  readonly avgCost: string | null;
  readonly lastCost: string | null;
}

export async function getStockCosts(session: SessionPayload, branchId: string | null): Promise<StockCostRow[]> {
  assertSuperadmin(session);
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select v.sku, m.name as model, c.name as color, z.label as size, coalesce(sum(sl.qty), 0)::int as qty,
              vc.avg_cost_bs::text as avg_cost, vc.last_cost_bs::text as last_cost
         from variants v join models m on m.id = v.model_id join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
         left join stock_levels sl on sl.variant_id = v.id and ($1::uuid is null or sl.branch_id = $1::uuid)
         left join variant_costs vc on vc.variant_id = v.id
        where v.active and m.active
        group by v.id, v.sku, m.name, c.name, z.label, z.sort_order, vc.avg_cost_bs, vc.last_cost_bs
        order by m.name, c.name, z.sort_order, v.sku`,
      [branchId],
    );
    return rows.map((row) => ({
      sku: row.sku, model: row.model, color: row.color, size: row.size, qty: row.qty,
      avgCost: row.avg_cost, lastCost: row.last_cost,
    }));
  });
}

export interface PurchaseExportRow {
  readonly batchDate: string;
  readonly supplier: string | null;
  readonly branchName: string;
  readonly rate70: string;
  readonly rate30: string;
  readonly splitPct: string;
  readonly freightBs: string;
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly size: string;
  readonly qty: number;
  readonly unitCostUsd: string;
  readonly unitCostBs: string;
}

/** One row per purchased item in the date range (batch_date), bounded by `limit`. */
export async function listPurchaseRows(
  session: SessionPayload,
  range: { from: string; to: string; branchId: string | null },
  limit: number,
): Promise<PurchaseExportRow[]> {
  assertSuperadmin(session);
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select b.batch_date, b.supplier, br.name as branch_name, b.rate_70::text, b.rate_30::text, b.split_pct::text,
              b.freight_bs::text, v.sku, m.name as model, c.name as color, z.label as size, i.qty,
              i.unit_cost_usd::text, i.unit_cost_bs_landed::text
         from purchase_items i
         join purchase_batches b on b.id = i.batch_id
         join branches br on br.id = b.branch_id
         join variants v on v.id = i.variant_id join models m on m.id = v.model_id
         join colors c on c.id = v.color_id join sizes z on z.id = v.size_id
        where b.batch_date between $1::date and $2::date and ($3::uuid is null or b.branch_id = $3::uuid)
        order by b.batch_date, b.created_at, v.sku limit $4`,
      [range.from, range.to, range.branchId, limit],
    );
    return rows.map((row) => ({
      batchDate: row.batch_date,
      supplier: row.supplier,
      branchName: row.branch_name,
      rate70: row.rate_70,
      rate30: row.rate_30,
      splitPct: row.split_pct,
      freightBs: row.freight_bs,
      sku: row.sku,
      model: row.model,
      color: row.color,
      size: row.size,
      qty: row.qty,
      unitCostUsd: row.unit_cost_usd,
      unitCostBs: row.unit_cost_bs_landed,
    }));
  });
}
