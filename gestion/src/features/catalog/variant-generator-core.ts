import { assignUniqueSkus, buildSkuBase } from "./sku";
import { CatalogError, type PgClient } from "./types";
import { planVariantMatrix, type VariantPair } from "./variant-matrix";

export interface GenerateInput {
  readonly modelId: string;
  readonly colorIds: readonly string[];
  readonly sizeIds: readonly string[];
}

export interface GenerateResult {
  readonly created: number;
  readonly skipped: number;
  readonly skus: readonly string[];
}

interface Named {
  id: string;
  name: string;
}
interface SizeRow {
  id: string;
  label: string;
}

async function loadModel(client: PgClient, modelId: string): Promise<{ name: string; line: string }> {
  // FOR UPDATE serialises two generations for the same model.
  const { rows } = await client.query<{ name: string; line: string; active: boolean }>(
    `select m.name, l.name as line, m.active
       from models m join product_lines l on l.id = m.line_id
      where m.id = $1 for update of m`,
    [modelId],
  );
  const model = rows[0];
  if (!model) throw new CatalogError("El modelo ya no existe.");
  if (!model.active) throw new CatalogError("Active el modelo antes de generar variantes.");
  return model;
}

async function loadAxes(client: PgClient, input: GenerateInput): Promise<{ colors: Named[]; sizes: SizeRow[] }> {
  const colorIds = [...new Set(input.colorIds)];
  const sizeIds = [...new Set(input.sizeIds)];
  // One pg client runs one query at a time: await sequentially.
  const colors = await client.query<Named>(
    "select id, name from colors where id = any($1::uuid[]) order by lower(name)",
    [colorIds],
  );
  const sizes = await client.query<SizeRow>(
    "select id, label from sizes where id = any($1::uuid[]) order by sort_order, label",
    [sizeIds],
  );
  if (colors.rows.length !== colorIds.length || sizes.rows.length !== sizeIds.length) {
    throw new CatalogError("Algún color o talla seleccionado ya no existe. Recargue la página.");
  }
  return { colors: colors.rows, sizes: sizes.rows };
}

async function takenSkus(client: PgClient, bases: readonly string[]): Promise<string[]> {
  const patterns = [...new Set(bases)].map((base) => `${base}%`);
  const { rows } = await client.query<{ sku: string }>("select sku from variants where sku like any($1::text[])", [
    patterns,
  ]);
  return rows.map((row) => row.sku);
}

/**
 * Creates every missing model x color x size combination inside the caller's
 * transaction. Existing combinations are skipped and counted, never duplicated.
 */
export async function generateVariantsTx(client: PgClient, input: GenerateInput): Promise<GenerateResult> {
  const model = await loadModel(client, input.modelId);
  const { colors, sizes } = await loadAxes(client, input);
  const existing = await client.query<{ color_id: string; size_id: string }>(
    "select color_id, size_id from variants where model_id = $1",
    [input.modelId],
  );
  const plan = planVariantMatrix({
    colorIds: colors.map((color) => color.id),
    sizeIds: sizes.map((size) => size.id),
    existing: existing.rows.map((row): VariantPair => ({ colorId: row.color_id, sizeId: row.size_id })),
  });
  if (plan.toCreate.length === 0) return { created: 0, skipped: plan.toSkip.length, skus: [] };

  const colorName = new Map(colors.map((color) => [color.id, color.name]));
  const sizeLabel = new Map(sizes.map((size) => [size.id, size.label]));
  const bases = plan.toCreate.map((pair) =>
    buildSkuBase({
      line: model.line,
      model: model.name,
      color: colorName.get(pair.colorId) ?? "",
      size: sizeLabel.get(pair.sizeId) ?? "",
    }),
  );
  const skus = assignUniqueSkus(bases, await takenSkus(client, bases));

  const inserted = await client.query<{ sku: string }>(
    `insert into variants (model_id, color_id, size_id, sku)
     select $1, c, s, k from unnest($2::uuid[], $3::uuid[], $4::text[]) as t(c, s, k)
     returning sku`,
    [input.modelId, plan.toCreate.map((p) => p.colorId), plan.toCreate.map((p) => p.sizeId), skus],
  );
  return { created: inserted.rows.length, skipped: plan.toSkip.length, skus: inserted.rows.map((r) => r.sku) };
}

