import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import type { VariantHit } from "./types";
import { foldText, queryVariants } from "./variant-query";
import type { VariantPair } from "./variant-matrix";

export interface CatalogSummary {
  readonly models: number;
  readonly activeModels: number;
  readonly variants: number;
  readonly activeVariants: number;
  readonly colors: number;
  readonly sizes: number;
  readonly lines: number;
  readonly units: number;
  readonly emptyModels: number;
  readonly withoutBarcode: number;
}

export async function getCatalogSummary(session: SessionPayload): Promise<CatalogSummary> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select
         (select count(*) from models)::int as models,
         (select count(*) from models where active)::int as active_models,
         (select count(*) from variants)::int as variants,
         (select count(*) from variants where active)::int as active_variants,
         (select count(*) from colors where active)::int as colors,
         (select count(*) from sizes where active)::int as sizes,
         (select count(*) from product_lines where active)::int as lines,
         (select coalesce(sum(qty), 0) from stock_levels)::int as units,
         (select count(*) from models m where m.active
            and not exists (select 1 from variants v where v.model_id = m.id))::int as empty_models,
         (select count(*) from variants where active and barcode is null)::int as without_barcode`,
    );
    const row = rows[0];
    return {
      models: row.models,
      activeModels: row.active_models,
      variants: row.variants,
      activeVariants: row.active_variants,
      colors: row.colors,
      sizes: row.sizes,
      lines: row.lines,
      units: row.units,
      emptyModels: row.empty_models,
      withoutBarcode: row.without_barcode,
    };
  });
}

export type StatusFilter = "all" | "active" | "inactive";

export interface ModelFilters {
  readonly lineId?: string;
  readonly status?: StatusFilter;
  readonly q?: string;
}

export interface ModelRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly price: string;
  readonly active: boolean;
  readonly lineId: string;
  readonly line: string;
  readonly variants: number;
  readonly activeVariants: number;
  readonly colors: number;
  readonly stock: number;
  readonly publishedOnline: boolean;
  readonly photos: number;
}

const MODEL_SELECT = `
  select m.id, m.name, m.description, m.base_sale_price as price, m.active,
         l.id as line_id, l.name as line,
         count(v.id)::int as variants,
         (count(v.id) filter (where v.active))::int as active_variants,
         count(distinct v.color_id)::int as colors,
         coalesce(sum(st.qty), 0)::int as stock,
         m.published_online,
         (select count(*) from model_images i where i.model_id = m.id)::int as photos
    from models m
    join product_lines l on l.id = m.line_id
    left join variants v on v.model_id = m.id
    left join (select variant_id, sum(qty) as qty from stock_levels group by variant_id) st
           on st.variant_id = v.id`;

function mapModel(row: Record<string, unknown>): ModelRow {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    price: row.price as string,
    active: row.active as boolean,
    lineId: row.line_id as string,
    line: row.line as string,
    variants: row.variants as number,
    activeVariants: row.active_variants as number,
    colors: row.colors as number,
    stock: row.stock as number,
    publishedOnline: row.published_online as boolean,
    photos: row.photos as number,
  };
}

export async function listModels(session: SessionPayload, filters: ModelFilters = {}): Promise<ModelRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.lineId) {
    values.push(filters.lineId);
    where.push(`m.line_id = $${values.length}`);
  }
  if (filters.status === "active") where.push("m.active");
  if (filters.status === "inactive") where.push("not m.active");
  if (filters.q?.trim()) {
    values.push(`%${foldText(filters.q.trim()).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`translate(lower(coalesce(m.name, '')), 'áéíóúüñ', 'aeiouun') like $${values.length}`);
  }
  const text = `${MODEL_SELECT}
    ${where.length ? `where ${where.join(" and ")}` : ""}
    group by m.id, l.id
    order by l.name, m.name
    limit 300`;
  return withUser(session, async (client) => (await client.query(text, values)).rows.map(mapModel));
}

export async function getModel(session: SessionPayload, id: string): Promise<ModelRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withUser(session, async (client) => {
    const { rows } = await client.query(`${MODEL_SELECT} where m.id = $1 group by m.id, l.id`, [id]);
    return rows[0] ? mapModel(rows[0]) : null;
  });
}

/** Every variant of a model (active or not), same shape as the search results. */
export function listModelVariants(session: SessionPayload, modelId: string): Promise<VariantHit[]> {
  return withUser(session, (client) =>
    queryVariants(client, { modelId, includeInactive: true, limit: 500 }),
  );
}

/** Color/size ids already generated for a model (drives the generator preview). */
export function listModelPairs(session: SessionPayload, modelId: string): Promise<VariantPair[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ color_id: string; size_id: string }>(
      "select color_id, size_id from variants where model_id = $1",
      [modelId],
    );
    return rows.map((row) => ({ colorId: row.color_id, sizeId: row.size_id }));
  });
}

export interface LineOption {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly models: number;
}
export interface ColorOption {
  readonly id: string;
  readonly name: string;
  readonly hex: string;
  readonly active: boolean;
  readonly variants: number;
}
export interface SizeOption {
  readonly id: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly active: boolean;
  readonly variants: number;
}

export interface Attributes {
  readonly lines: readonly LineOption[];
  readonly colors: readonly ColorOption[];
  readonly sizes: readonly SizeOption[];
}

export async function listAttributes(session: SessionPayload): Promise<Attributes> {
  return withUser(session, async (client) => {
    // Sequential on purpose: a pg client cannot run queries concurrently.
    const lines = await client.query(
      `select l.id, l.name, l.active, count(m.id)::int as models
         from product_lines l left join models m on m.line_id = l.id
        group by l.id order by l.name`,
    );
    const colors = await client.query(
      `select c.id, c.name, coalesce(c.hex, '#8a8070') as hex, c.active, count(v.id)::int as variants
         from colors c left join variants v on v.color_id = c.id
        group by c.id order by lower(c.name)`,
    );
    const sizes = await client.query(
      `select s.id, s.label, s.sort_order, s.active, count(v.id)::int as variants
         from sizes s left join variants v on v.size_id = s.id
        group by s.id order by s.sort_order, s.label`,
    );
    return {
      lines: lines.rows.map((r) => ({ id: r.id, name: r.name, active: r.active, models: r.models })),
      colors: colors.rows.map((r) => ({ id: r.id, name: r.name, hex: r.hex, active: r.active, variants: r.variants })),
      sizes: sizes.rows.map((r) => ({
        id: r.id,
        label: r.label,
        sortOrder: r.sort_order,
        active: r.active,
        variants: r.variants,
      })),
    };
  });
}
