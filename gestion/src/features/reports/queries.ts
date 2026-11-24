import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { subMoney, sumMoney, toMoney } from "@/lib/money";
import { type PaymentMethod } from "@/features/sales/payments";
import {
  buildHeatmap,
  fillDailySeries,
  mergeByMethod,
  sumByMethod,
  ticketAverage,
  type DailyPoint,
  type Heatmap,
  type MethodRow,
} from "./aggregate";
import { movementLinesSql } from "./movement-sql";
import { inRangeSql, LA_PAZ, ownerSql, scopeValues, type ReportScope } from "./scope";

/*
 * SELLER-SAFE reports. Nothing in this file reads a cost table or a cost column, so the same
 * functions serve both roles (a seller is additionally pinned to their branch + own sales by
 * scopeFor, and sellers have no GRANT on the cost tables at all). Cost, margin and profit live in
 * cost-queries.ts, which refuses to run for anyone but the superadmin.
 */

export interface SalesSummary {
  readonly count: number;
  readonly amount: string;
  readonly averageTicket: string;
  readonly units: number;
  readonly listAmount: string;
  readonly discountTotal: string;
  readonly discountedLines: number;
  /** Per method: payments of completed sales, exchange differences and the net. */
  readonly methods: readonly MethodRow[];
  readonly exchangeCount: number;
  readonly exchangeNet: string;
  readonly voidCount: number;
  readonly voidAmount: string;
}

export async function getSalesSummary(session: SessionPayload, scope: ReportScope): Promise<SalesSummary> {
  const values = scopeValues(scope);
  const sale = `${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}`;
  return withUser(session, async (client) => {
    const totals = await client.query(
      `select count(*)::int as count, coalesce(sum(s.total), 0)::text as amount,
              coalesce(sum(u.units), 0)::int as units, coalesce(sum(u.list), 0)::text as list_amount,
              coalesce(sum(u.discounted), 0)::int as discounted
         from sales s
         left join lateral (
           select sum(i.qty) as units, sum(i.qty * i.list_price) as list,
                  count(*) filter (where i.final_price < i.list_price) as discounted
             from sale_items i where i.sale_id = s.id) u on true
        where s.status = 'completed' and ${sale}`,
      values,
    );
    const pay = await client.query<{ method: PaymentMethod; amount: string }>(
      `select p.method, sum(p.amount)::text as amount
         from sale_payments p join sales s on s.id = p.sale_id
        where s.status = 'completed' and ${sale} group by p.method`,
      values,
    );
    const exchanges = await client.query<{ method: PaymentMethod | null; count: number; amount: string }>(
      `select e.payment_method as method, count(*)::int as count, sum(e.price_diff)::text as amount
         from exchanges e join sales s on s.id = e.original_sale_id
        where s.status = 'completed' and ${inRangeSql("e.created_at")} and ${ownerSql("e.branch_id", "s.seller_id")}
        group by e.payment_method`,
      values,
    );
    const voids = await client.query<{ count: number; amount: string }>(
      `select count(*)::int as count, coalesce(sum(s.total), 0)::text as amount
         from sales s where s.status = 'voided' and ${sale}`,
      values,
    );
    const t = totals.rows[0];
    const byMethod = exchanges.rows.filter((r): r is typeof r & { method: PaymentMethod } => r.method !== null);
    const exchangeByMethod = sumByMethod(byMethod.map((r) => ({ method: r.method, amount: r.amount })));
    return {
      count: t.count,
      amount: toMoney(t.amount),
      averageTicket: ticketAverage(t.amount, t.count),
      units: t.units,
      listAmount: toMoney(t.list_amount),
      discountTotal: subMoney(t.list_amount, t.amount),
      discountedLines: t.discounted,
      methods: mergeByMethod(sumByMethod(pay.rows), exchangeByMethod),
      exchangeCount: exchanges.rows.reduce((sum, r) => sum + r.count, 0),
      exchangeNet: sumMoney(exchanges.rows.map((r) => r.amount)),
      voidCount: voids.rows[0].count,
      voidAmount: toMoney(voids.rows[0].amount),
    };
  });
}

export async function getDailySales(session: SessionPayload, scope: ReportScope): Promise<DailyPoint[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ day: string; total: string; count: number }>(
      `select (s.created_at at time zone '${LA_PAZ}')::date as day, sum(s.total)::text as total, count(*)::int as count
         from sales s
        where s.status = 'completed' and ${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}
        group by 1 order by 1`,
      scopeValues(scope),
    );
    return fillDailySeries(rows.map((r) => ({ day: r.day, total: toMoney(r.total), count: r.count })), scope);
  });
}

export interface ModelSizeRow {
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly size: string;
  readonly sizeOrder: number;
  readonly units: number;
  readonly revenue: string;
}

/** Units and revenue per model and size, NET of exchanges (see movementLinesSql). */
export async function getModelSizeSales(session: SessionPayload, scope: ReportScope): Promise<ModelSizeRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `with lines as (${movementLinesSql(false)})
       select m.id as model_id, m.name as model, pl.name as line, z.label as size, z.sort_order,
              sum(l.units)::int as units, sum(l.revenue)::text as revenue
         from lines l
         join variants v on v.id = l.variant_id
         join models m on m.id = v.model_id
         join product_lines pl on pl.id = m.line_id
         join sizes z on z.id = v.size_id
        group by m.id, m.name, pl.name, z.label, z.sort_order
       having sum(l.units) <> 0
        order by m.name, z.sort_order`,
      scopeValues(scope),
    );
    return rows.map((row) => ({
      modelId: row.model_id,
      model: row.model,
      line: row.line,
      size: row.size,
      sizeOrder: row.sort_order,
      units: row.units,
      revenue: toMoney(row.revenue),
    }));
  });
}

export interface ModelTotal {
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly units: number;
  readonly revenue: string;
}

export function totalsByModel(rows: readonly ModelSizeRow[]): ModelTotal[] {
  const byModel = new Map<string, { row: ModelSizeRow; units: number; revenue: string[] }>();
  for (const row of rows) {
    const current = byModel.get(row.modelId) ?? { row, units: 0, revenue: [] };
    byModel.set(row.modelId, { row, units: current.units + row.units, revenue: [...current.revenue, row.revenue] });
  }
  return [...byModel.values()]
    .map(({ row, units, revenue }) => ({ modelId: row.modelId, model: row.model, line: row.line, units, revenue: sumMoney(revenue) }))
    .sort((a, b) => b.units - a.units || a.model.localeCompare(b.model));
}

export const heatmapOf = (rows: readonly ModelSizeRow[]): Heatmap => buildHeatmap(rows);

export interface SellerRow {
  readonly sellerId: string;
  readonly sellerName: string;
  readonly count: number;
  readonly amount: string;
  readonly averageTicket: string;
  readonly units: number;
  readonly discountTotal: string;
}

export async function getSalesBySeller(session: SessionPayload, scope: ReportScope): Promise<SellerRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select s.seller_id, coalesce(td.full_name, 'Sin nombre') as seller_name, count(*)::int as count,
              sum(s.total)::text as amount, coalesce(sum(u.units), 0)::int as units,
              coalesce(sum(u.list), 0)::text as list_amount
         from sales s
         left join team_directory() td on td.id = s.seller_id
         left join lateral (select sum(i.qty) as units, sum(i.qty * i.list_price) as list from sale_items i where i.sale_id = s.id) u on true
        where s.status = 'completed' and ${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}
        group by s.seller_id, td.full_name order by sum(s.total) desc`,
      scopeValues(scope),
    );
    return rows.map((row) => ({
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      count: row.count,
      amount: toMoney(row.amount),
      averageTicket: ticketAverage(row.amount, row.count),
      units: row.units,
      discountTotal: subMoney(row.list_amount, row.amount),
    }));
  });
}

export interface DiscountRow {
  readonly saleId: string;
  readonly saleNumber: number;
  readonly createdAt: string;
  readonly sellerName: string | null;
  readonly listTotal: string;
  readonly total: string;
  readonly discount: string;
  readonly percent: string;
}

/** Sales with a discount (price charged under list price), biggest first. */
export async function listTopDiscounts(session: SessionPayload, scope: ReportScope, limit = 10): Promise<DiscountRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select * from (
         select s.id, s.sale_number, s.created_at, td.full_name as seller_name,
                (select sum(i.qty * i.list_price) from sale_items i where i.sale_id = s.id) as list_total, s.total
           from sales s left join team_directory() td on td.id = s.seller_id
          where s.status = 'completed' and ${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}
       ) x where x.list_total > x.total order by (x.list_total - x.total) desc limit $6`,
      [...scopeValues(scope), limit],
    );
    return rows.map((row) => ({
      saleId: row.id,
      saleNumber: Number(row.sale_number),
      createdAt: row.created_at.toISOString(),
      sellerName: row.seller_name,
      listTotal: toMoney(row.list_total),
      total: toMoney(row.total),
      discount: subMoney(row.list_total, row.total),
      percent: ((1 - Number(row.total) / Number(row.list_total)) * 100).toFixed(1),
    }));
  });
}

export interface ExchangeReportRow {
  readonly id: string;
  readonly createdAt: string;
  readonly saleId: string;
  readonly saleNumber: number;
  readonly returned: string;
  readonly replacement: string;
  readonly qty: number;
  readonly priceDiff: string;
  readonly method: PaymentMethod | null;
  readonly reason: string | null;
  readonly userName: string | null;
}

export async function listExchangesInPeriod(session: SessionPayload, scope: ReportScope, limit = 500): Promise<ExchangeReportRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select e.id, e.created_at, s.id as sale_id, s.sale_number, e.qty, e.price_diff::text as price_diff,
              e.payment_method, e.reason, td.full_name as user_name,
              rm.name || ' ' || rc.name || ' T' || rz.label as returned,
              nm.name || ' ' || nc.name || ' T' || nz.label as replacement
         from exchanges e
         join sales s on s.id = e.original_sale_id
         join variants rv on rv.id = e.returned_variant_id join models rm on rm.id = rv.model_id
           join colors rc on rc.id = rv.color_id join sizes rz on rz.id = rv.size_id
         join variants nv on nv.id = e.new_variant_id join models nm on nm.id = nv.model_id
           join colors nc on nc.id = nv.color_id join sizes nz on nz.id = nv.size_id
         left join team_directory() td on td.id = e.created_by
        where ${inRangeSql("e.created_at")} and ${ownerSql("e.branch_id", "s.seller_id")}
        order by e.created_at desc limit $6`,
      [...scopeValues(scope), limit],
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      saleId: row.sale_id,
      saleNumber: Number(row.sale_number),
      returned: row.returned,
      replacement: row.replacement,
      qty: row.qty,
      priceDiff: row.price_diff,
      method: row.payment_method,
      reason: row.reason,
      userName: row.user_name,
    }));
  });
}

export interface VoidReportRow {
  readonly saleId: string;
  readonly saleNumber: number;
  readonly createdAt: string;
  readonly voidedAt: string;
  readonly total: string;
  readonly reason: string | null;
  readonly sellerName: string | null;
  readonly voidedByName: string | null;
}

/** Sales created in the period that were voided (listed, never counted in totals). */
export async function listVoidsInPeriod(session: SessionPayload, scope: ReportScope, limit = 500): Promise<VoidReportRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select s.id, s.sale_number, s.created_at, s.voided_at, s.total::text as total, s.void_reason,
              td.full_name as seller_name, vb.full_name as voided_by_name
         from sales s
         left join team_directory() td on td.id = s.seller_id
         left join team_directory() vb on vb.id = s.voided_by
        where s.status = 'voided' and ${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}
        order by s.voided_at desc limit $6`,
      [...scopeValues(scope), limit],
    );
    return rows.map((row) => ({
      saleId: row.id,
      saleNumber: Number(row.sale_number),
      createdAt: row.created_at.toISOString(),
      voidedAt: row.voided_at.toISOString(),
      total: row.total,
      reason: row.void_reason,
      sellerName: row.seller_name,
      voidedByName: row.voided_by_name,
    }));
  });
}

export interface StockVariantRow {
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly color: string;
  readonly colorId: string;
  readonly colorHex: string | null;
  readonly size: string;
  readonly sizeId: string;
  readonly sizeOrder: number;
  readonly sku: string;
  readonly qty: number;
  readonly price: string;
}

/**
 * Current stock of every active variant (0 when it has no row). Sellers see their branch only (RLS);
 * the superadmin may narrow to one branch. NO cost column: the cost version is in cost-queries.ts.
 */
export async function getStockVariants(session: SessionPayload, branchId: string | null): Promise<StockVariantRow[]> {
  const branch = session.role === "seller" ? session.branchId : branchId;
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select m.id as model_id, m.name as model, pl.name as line, c.id as color_id, c.name as color, c.hex,
              z.id as size_id, z.label as size, z.sort_order, v.sku, m.base_sale_price::text as price,
              coalesce(sum(sl.qty), 0)::int as qty
         from variants v
         join models m on m.id = v.model_id
         join product_lines pl on pl.id = m.line_id
         join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
         left join stock_levels sl on sl.variant_id = v.id and ($1::uuid is null or sl.branch_id = $1::uuid)
        where v.active and m.active
        group by m.id, m.name, pl.name, c.id, c.name, c.hex, z.id, z.label, z.sort_order, v.sku, m.base_sale_price
        order by m.name, c.name, z.sort_order, v.sku`,
      [branch],
    );
    return rows.map((row) => ({
      modelId: row.model_id,
      model: row.model,
      line: row.line,
      color: row.color,
      colorId: row.color_id,
      colorHex: row.hex,
      size: row.size,
      sizeId: row.size_id,
      sizeOrder: row.sort_order,
      sku: row.sku,
      qty: row.qty,
      price: row.price,
    }));
  });
}
