import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { buildPage, clampPage, type Page, type PageRequest } from "@/lib/pagination";

const TZ = "America/La_Paz";

export interface TransferFilters {
  readonly from?: string;
  readonly to?: string;
  /** Matches transfers that leave OR arrive at this branch. */
  readonly branchId?: string;
}

export interface TransferRow {
  readonly id: string;
  readonly number: number;
  readonly createdAt: string;
  readonly fromName: string;
  readonly toName: string;
  readonly byName: string | null;
  readonly note: string | null;
  readonly products: number;
  readonly units: number;
}

export interface TransferLineRow {
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly size: string;
  readonly qty: number;
}

export interface TransferDetail extends TransferRow {
  readonly fromId: string;
  readonly toId: string;
  readonly lines: readonly TransferLineRow[];
}

function whereFor(filters: TransferFilters): { clause: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const add = (sql: (p: string) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(`$${values.length}`));
  };
  if (filters.from) add((p) => `t.created_at >= (${p}::date)::timestamp at time zone '${TZ}'`, filters.from);
  if (filters.to) add((p) => `t.created_at < ((${p}::date) + 1)::timestamp at time zone '${TZ}'`, filters.to);
  if (filters.branchId) add((p) => `(t.from_branch_id = ${p}::uuid or t.to_branch_id = ${p}::uuid)`, filters.branchId);
  return { clause: conditions.length ? `where ${conditions.join(" and ")}` : "", values };
}

const SELECT = `
  select t.id, t.transfer_number, t.created_at, t.note, t.from_branch_id, t.to_branch_id,
         fb.name as from_name, tb.name as to_name, td.full_name as by_name,
         (select count(*)::int from stock_movements m where m.ref_table = 'stock_transfers' and m.ref_id = t.id and m.qty > 0) as products,
         (select coalesce(sum(m.qty), 0)::int from stock_movements m where m.ref_table = 'stock_transfers' and m.ref_id = t.id and m.qty > 0) as units
    from stock_transfers t
    join branches fb on fb.id = t.from_branch_id
    join branches tb on tb.id = t.to_branch_id
    left join team_directory() td on td.id = t.created_by`;

function mapRow(row: Record<string, unknown>): TransferRow {
  return {
    id: row.id as string,
    number: Number(row.transfer_number),
    createdAt: (row.created_at as Date).toISOString(),
    fromName: row.from_name as string,
    toName: row.to_name as string,
    byName: (row.by_name as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    products: row.products as number,
    units: row.units as number,
  };
}

/** Superadmin only: sellers have no grant on stock_transfers (the query fails closed). */
export async function listTransfers(session: SessionPayload, filters: TransferFilters, request: PageRequest): Promise<Page<TransferRow>> {
  const { clause, values } = whereFor(filters);
  return withUser(session, async (client) => {
    const counted = await client.query<{ total: number }>(`select count(*)::int as total from stock_transfers t ${clause}`, values);
    const total = counted.rows[0].total;
    const page = clampPage(request.page, total, request.pageSize);
    const { rows } = await client.query(
      `${SELECT} ${clause} order by t.created_at desc, t.transfer_number desc limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, request.pageSize, (page - 1) * request.pageSize],
    );
    return buildPage(rows.map(mapRow), total, { page, pageSize: request.pageSize });
  });
}

export async function getTransfer(session: SessionPayload, id: string): Promise<TransferDetail | null> {
  return withUser(session, async (client) => {
    const head = await client.query(`${SELECT} where t.id = $1`, [id]);
    if (head.rows.length === 0) return null;
    const lines = await client.query(
      `select v.sku, m.name as model, c.name as color, z.label as size, sm.qty
         from stock_movements sm
         join variants v on v.id = sm.variant_id
         join models m on m.id = v.model_id
         join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
        where sm.ref_table = 'stock_transfers' and sm.ref_id = $1 and sm.qty > 0
        order by m.name, c.name, z.sort_order, v.sku`,
      [id],
    );
    return {
      ...mapRow(head.rows[0]),
      fromId: head.rows[0].from_branch_id,
      toId: head.rows[0].to_branch_id,
      lines: lines.rows.map((row) => ({ sku: row.sku, model: row.model, color: row.color, size: row.size, qty: row.qty })),
    };
  });
}
