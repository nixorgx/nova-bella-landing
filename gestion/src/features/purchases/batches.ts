import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { buildPage, clampPage, type Page, type PageRequest } from "@/lib/pagination";
import type { ParsedDraft } from "./form-math";

export interface BatchMeta {
  readonly branchId: string;
  readonly batchDate: string;
  readonly supplier: string | null;
  readonly notes: string | null;
}

/** Calls the transactional create_purchase_batch RPC (batch + items + stock + costs, or nothing). */
export async function createBatch(session: SessionPayload, meta: BatchMeta, draft: ParsedDraft): Promise<string> {
  const items = draft.items.map((item) => ({
    variant_id: item.variantId,
    qty: item.qty,
    unit_cost_usd: item.unitCostUsd,
  }));
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select create_purchase_batch($1, $2, $3::date, $4, $5, $6, $7, $8, $9::jsonb) as id",
      [meta.branchId, meta.supplier, meta.batchDate, draft.rate70, draft.rate30, draft.splitPct, draft.freightBs, meta.notes, JSON.stringify(items)],
    );
    return rows[0].id;
  });
}

export interface BatchFilters {
  readonly from?: string;
  readonly to?: string;
  readonly branchId?: string;
  readonly supplier?: string;
}

export interface BatchRow {
  readonly id: string;
  readonly batchDate: string;
  readonly supplier: string | null;
  readonly branchName: string;
  readonly products: number;
  readonly units: number;
  readonly freightBs: string;
  readonly totalBs: string;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function whereFor(filters: BatchFilters): { clause: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const add = (sql: (placeholder: string) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(`$${values.length}`));
  };
  if (filters.from) add((p) => `pb.batch_date >= ${p}::date`, filters.from);
  if (filters.to) add((p) => `pb.batch_date <= ${p}::date`, filters.to);
  if (filters.branchId) add((p) => `pb.branch_id = ${p}::uuid`, filters.branchId);
  if (filters.supplier) add((p) => `coalesce(pb.supplier, '') ilike ${p}`, `%${escapeLike(filters.supplier ?? "")}%`);
  return { clause: conditions.length ? `where ${conditions.join(" and ")}` : "", values };
}

export async function listBatches(
  session: SessionPayload,
  filters: BatchFilters,
  request: PageRequest,
): Promise<Page<BatchRow>> {
  const { clause, values } = whereFor(filters);
  return withUser(session, async (client) => {
    const counted = await client.query<{ total: number }>(
      `select count(*)::int as total from purchase_batches pb ${clause}`,
      values,
    );
    const total = counted.rows[0].total;
    const page = clampPage(request.page, total, request.pageSize);
    const { rows } = await client.query(
      `select pb.id, pb.batch_date, pb.supplier, b.name as branch_name, pb.freight_bs::text as freight_bs,
              t.products, t.units, t.total_bs::text as total_bs
         from purchase_batches pb
         join branches b on b.id = pb.branch_id
         join lateral (
           select count(*)::int as products, coalesce(sum(i.qty), 0)::int as units,
                  coalesce(sum(i.qty * i.unit_cost_bs_landed), 0) as total_bs
             from purchase_items i where i.batch_id = pb.id
         ) t on true
        ${clause}
        order by pb.batch_date desc, pb.created_at desc
        limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, request.pageSize, (page - 1) * request.pageSize],
    );
    const mapped: BatchRow[] = rows.map((row) => ({
      id: row.id,
      batchDate: row.batch_date,
      supplier: row.supplier,
      branchName: row.branch_name,
      products: row.products,
      units: row.units,
      freightBs: row.freight_bs,
      totalBs: row.total_bs,
    }));
    return buildPage(mapped, total, { page, pageSize: request.pageSize });
  });
}

export async function listSuppliers(session: SessionPayload): Promise<string[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ supplier: string }>(
      "select distinct supplier from purchase_batches where supplier is not null order by supplier limit 50",
    );
    return rows.map((row) => row.supplier);
  });
}

export interface BatchItemDetail {
  readonly variantId: string;
  readonly modelId: string;
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly colorHex: string | null;
  readonly size: string;
  readonly qty: number;
  readonly unitCostUsd: string;
  readonly unitCostBsLanded: string;
}

export interface BatchDetail {
  readonly id: string;
  readonly batchDate: string;
  readonly supplier: string | null;
  readonly branchName: string;
  readonly rate70: string;
  readonly rate30: string;
  readonly splitPct: string;
  readonly freightBs: string;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly items: readonly BatchItemDetail[];
}

export async function getBatch(session: SessionPayload, id: string): Promise<BatchDetail | null> {
  return withUser(session, async (client) => {
    const head = await client.query(
      `select pb.id, pb.batch_date, pb.supplier, b.name as branch_name, pb.rate_70::text as rate_70,
              pb.rate_30::text as rate_30, pb.split_pct::text as split_pct, pb.freight_bs::text as freight_bs,
              pb.notes, pb.created_at, td.full_name as created_by_name
         from purchase_batches pb
         join branches b on b.id = pb.branch_id
         left join team_directory() td on td.id = pb.created_by
        where pb.id = $1`,
      [id],
    );
    const row = head.rows[0];
    if (!row) return null;
    const items = await client.query(
      `select i.variant_id, v.model_id, v.sku, m.name as model, c.name as color, c.hex, z.label as size,
              i.qty, i.unit_cost_usd::text as unit_cost_usd, i.unit_cost_bs_landed::text as landed
         from purchase_items i
         join variants v on v.id = i.variant_id
         join models m on m.id = v.model_id
         join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
        where i.batch_id = $1 order by m.name, c.name, z.sort_order, v.sku`,
      [id],
    );
    return {
      id: row.id,
      batchDate: row.batch_date,
      supplier: row.supplier,
      branchName: row.branch_name,
      rate70: row.rate_70,
      rate30: row.rate_30,
      splitPct: row.split_pct,
      freightBs: row.freight_bs,
      notes: row.notes,
      createdAt: new Date(row.created_at).toISOString(),
      createdByName: row.created_by_name,
      items: items.rows.map((item) => ({
        variantId: item.variant_id,
        modelId: item.model_id,
        sku: item.sku,
        model: item.model,
        color: item.color,
        colorHex: item.hex,
        size: item.size,
        qty: item.qty,
        unitCostUsd: item.unit_cost_usd,
        unitCostBsLanded: item.landed,
      })),
    };
  });
}
