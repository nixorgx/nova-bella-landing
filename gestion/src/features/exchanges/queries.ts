import type { PoolClient } from "pg";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import type { PaymentMethod } from "@/features/sales/payments";
import { netOfLines } from "./price-diff";

export interface ExchangeLineView {
  readonly id: string;
  readonly returned: { sku: string; model: string; color: string; size: string };
  readonly replacement: { sku: string; model: string; color: string; size: string };
  readonly qty: number;
  readonly priceDiff: string;
}

/** Lines confirmed together (one receipt). Older rows without group_id are their own group. */
export interface ExchangeGroup {
  readonly groupId: string;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly reason: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly net: string;
  readonly lines: readonly ExchangeLineView[];
}

interface Row {
  id: string;
  group_id: string;
  created_at: Date;
  created_by_name: string | null;
  reason: string | null;
  payment_method: PaymentMethod | null;
  qty: number;
  price_diff: string;
  r_sku: string; r_model: string; r_color: string; r_size: string;
  n_sku: string; n_model: string; n_color: string; n_size: string;
}

const EXCHANGE_SELECT = `
  select e.id, coalesce(e.group_id, e.id) as group_id, e.created_at, td.full_name as created_by_name,
         e.reason, e.payment_method, e.qty, e.price_diff::text as price_diff,
         rv.sku as r_sku, rm.name as r_model, rc.name as r_color, rz.label as r_size,
         nv.sku as n_sku, nm.name as n_model, nc.name as n_color, nz.label as n_size
    from exchanges e
    join variants rv on rv.id = e.returned_variant_id
    join models rm on rm.id = rv.model_id
    join colors rc on rc.id = rv.color_id
    join sizes rz on rz.id = rv.size_id
    join variants nv on nv.id = e.new_variant_id
    join models nm on nm.id = nv.model_id
    join colors nc on nc.id = nv.color_id
    join sizes nz on nz.id = nv.size_id
    left join team_directory() td on td.id = e.created_by`;

function groupRows(rows: readonly Row[]): ExchangeGroup[] {
  const order: string[] = [];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (!groups.has(row.group_id)) order.push(row.group_id);
    groups.set(row.group_id, [...(groups.get(row.group_id) ?? []), row]);
  }
  return order.map((groupId) => {
    const members = groups.get(groupId) ?? [];
    const head = members[0];
    return {
      groupId,
      createdAt: head.created_at.toISOString(),
      createdByName: head.created_by_name,
      reason: head.reason,
      paymentMethod: head.payment_method,
      net: netOfLines(members.map((m) => m.price_diff)),
      lines: members.map((m) => ({
        id: m.id,
        returned: { sku: m.r_sku, model: m.r_model, color: m.r_color, size: m.r_size },
        replacement: { sku: m.n_sku, model: m.n_model, color: m.n_color, size: m.n_size },
        qty: m.qty,
        priceDiff: m.price_diff,
      })),
    };
  });
}

/** Exchanges of one sale, oldest first, grouped per confirmation. Safe for both roles (no costs). */
export async function readSaleExchanges(client: PoolClient, saleId: string): Promise<ExchangeGroup[]> {
  const { rows } = await client.query<Row>(
    `${EXCHANGE_SELECT} where e.original_sale_id = $1 order by e.created_at, e.id`,
    [saleId],
  );
  return groupRows(rows);
}

export interface ReturnableLine {
  readonly variantId: string;
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly size: string;
  readonly sold: number;
  readonly exchanged: number;
  readonly remaining: number;
  readonly paidUnit: string;
}

/** Sale lines with how many pairs can still be exchanged (sold - already exchanged). */
export async function readReturnableLines(client: PoolClient, saleId: string): Promise<ReturnableLine[]> {
  const { rows } = await client.query(
    `select v.id as variant_id, v.sku, m.name as model, c.name as color, z.label as size,
            sum(i.qty)::int as sold,
            coalesce((select sum(e.qty) from exchanges e
                       where e.original_sale_id = i.sale_id and e.returned_variant_id = i.variant_id), 0)::int as exchanged,
            round(sum(i.qty * i.final_price) / nullif(sum(i.qty), 0), 2)::text as paid_unit
       from sale_items i
       join variants v on v.id = i.variant_id
       join models m on m.id = v.model_id
       join colors c on c.id = v.color_id
       join sizes z on z.id = v.size_id
      where i.sale_id = $1
      group by v.id, v.sku, m.name, c.name, z.label, z.sort_order, i.sale_id, i.variant_id
      order by m.name, c.name, z.sort_order, v.sku`,
    [saleId],
  );
  return rows.map((row) => ({
    variantId: row.variant_id,
    sku: row.sku,
    model: row.model,
    color: row.color,
    size: row.size,
    sold: row.sold,
    exchanged: row.exchanged,
    remaining: row.sold - row.exchanged,
    paidUnit: row.paid_unit,
  }));
}

export async function readExchangeGroup(client: PoolClient, saleId: string, groupId: string): Promise<ExchangeGroup | null> {
  const { rows } = await client.query<Row>(
    `${EXCHANGE_SELECT} where e.original_sale_id = $1 and coalesce(e.group_id, e.id) = $2 order by e.created_at, e.id`,
    [saleId, groupId],
  );
  return groupRows(rows)[0] ?? null;
}

export function getReturnableLines(session: SessionPayload, saleId: string): Promise<ReturnableLine[]> {
  return withUser(session, (client) => readReturnableLines(client, saleId));
}
