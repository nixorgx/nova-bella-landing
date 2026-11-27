import type { PgClient, VariantHit } from "./types";

export interface VariantQueryOptions {
  readonly tokens?: readonly string[];
  /** Raw (unsplit) query, used only to rank exact SKU / barcode matches first. */
  readonly rawQuery?: string;
  readonly modelId?: string;
  /** Exact barcode or SKU (scanner lookups). */
  readonly code?: string;
  readonly includeInactive?: boolean;
  /** null/undefined = every branch the database role is allowed to see. */
  readonly branchId?: string | null;
  readonly limit: number;
}

interface HitRow {
  variant_id: string;
  sku: string;
  barcode: string | null;
  model_id: string;
  model: string;
  line: string;
  color: string;
  color_hex: string | null;
  size: string;
  price: string;
  stock: number;
  active: boolean;
  model_active: boolean;
}

const FOLD_FROM = "áéíóúüñ";
const FOLD_TO = "aeiouun";

/** Lowercases and removes Spanish accents so "cafe" finds "Café". */
export function foldText(text: string): string {
  return text.toLowerCase().replace(/[áéíóúüñ]/g, (char) => FOLD_TO[FOLD_FROM.indexOf(char)]);
}

function fold(expression: string): string {
  return `translate(lower(${expression}), '${FOLD_FROM}', '${FOLD_TO}')`;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const SEARCH_COLUMNS = ["v.sku", "v.barcode", "m.name", "c.name", "s.label", "l.name"];

function tokenCondition(placeholder: string): string {
  const parts = SEARCH_COLUMNS.map((column) => `${fold(`coalesce(${column}, '')`)} like ${placeholder}`);
  return `(${parts.join(" or ")})`;
}

interface Built {
  readonly text: string;
  readonly values: readonly unknown[];
}

function buildQuery(options: VariantQueryOptions): Built {
  const values: unknown[] = [];
  const param = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const branch = param(options.branchId ?? null);
  const where: string[] = [];
  if (!options.includeInactive) where.push("v.active and m.active");
  if (options.modelId) where.push(`m.id = ${param(options.modelId)}`);
  if (options.code) {
    const code = param(options.code);
    where.push(`(v.barcode = ${code} or upper(v.sku) = upper(${code}))`);
  }
  for (const token of options.tokens ?? []) {
    where.push(tokenCondition(param(`%${escapeLike(foldText(token))}%`)));
  }

  const raw = (options.rawQuery ?? "").trim();
  let rank = "2";
  if (raw) {
    const exact = param(raw);
    const prefix = param(`${escapeLike(raw)}%`);
    rank = `case when upper(v.sku) = upper(${exact}) or v.barcode = ${exact} then 0
                 when upper(v.sku) like upper(${prefix}) then 1 else 2 end`;
  }

  const text = `
    select v.id as variant_id, v.sku, v.barcode, m.id as model_id, m.name as model,
           l.name as line, c.name as color, c.hex as color_hex, s.label as size,
           m.base_sale_price as price, coalesce(st.qty, 0)::int as stock,
           v.active, m.active as model_active
      from variants v
      join models m on m.id = v.model_id
      join product_lines l on l.id = m.line_id
      join colors c on c.id = v.color_id
      join sizes s on s.id = v.size_id
      left join lateral (
        select sum(sl.qty) as qty from stock_levels sl
         where sl.variant_id = v.id and (${branch}::uuid is null or sl.branch_id = ${branch}::uuid)
      ) st on true
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by ${rank}, m.name, c.name, s.sort_order, s.label
     limit ${param(options.limit)}`;
  return { text, values };
}

export function mapHit(row: HitRow): VariantHit {
  return {
    variantId: row.variant_id,
    sku: row.sku,
    barcode: row.barcode,
    modelId: row.model_id,
    model: row.model,
    line: row.line,
    color: row.color,
    colorHex: row.color_hex,
    size: row.size,
    price: row.price,
    stock: row.stock,
    active: row.active,
    modelActive: row.model_active,
  };
}

/** Runs the shared variant lookup on an already role-scoped client. */
export async function queryVariants(client: PgClient, options: VariantQueryOptions): Promise<VariantHit[]> {
  const { text, values } = buildQuery(options);
  const { rows } = await client.query<HitRow>(text, [...values]);
  return rows.map(mapHit);
}
