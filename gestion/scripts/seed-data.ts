import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { generateVariantsTx } from "../src/features/catalog/variant-generator-core";
import { applyUserContext } from "../src/lib/db-context";
import { bcryptCost } from "../src/lib/env";
import { say } from "./lib/log";
import { resolveSeedUsers, type ResolvedSeedUser } from "./lib/seed-passwords";
import { seedDemo2 } from "./seed-demo2";
import { seedExtras, seedHistory } from "./seed-demo3";
import { seedStore } from "./seed-store";

const LINES = ["Dama", "Caballero", "Niños"];

/** Sizes keep their numeric value as sort order, so kids' sizes sort before adults'. */
const SIZE_RANGE = { min: 22, max: 44 };

const COLORS: ReadonlyArray<readonly [string, string]> = [
  ["Negro", "#1d1b17"],
  ["Blanco", "#f4f1ea"],
  ["Café", "#6b4226"],
  ["Beige", "#d8c3a5"],
  ["Rojo", "#b3261e"],
  ["Azul marino", "#1f2f56"],
  ["Rosado", "#e8a1b0"],
  ["Gris", "#8a8a85"],
  ["Mostaza", "#c9922b"],
  ["Verde oliva", "#6b6b34"],
  ["Miel", "#b9803a"],
  ["Vino", "#6d1f33"],
];

interface ModelSeed {
  readonly line: string;
  readonly name: string;
  readonly price: string;
  readonly description: string;
  readonly colors: readonly string[];
  readonly sizes: readonly [number, number];
  readonly costUsd: string;
  /** Batch (1 or 2) that brings the stock; null = catalog entry still without variants. */
  readonly batch: 1 | 2 | null;
}

const MODELS: readonly ModelSeed[] = [
  { line: "Dama", name: "Alba", price: "189.00", description: "Sandalia plana de cuero con hebilla.", colors: ["Negro", "Beige", "Rojo", "Rosado", "Miel"], sizes: [35, 40], costUsd: "14.50", batch: 1 },
  { line: "Dama", name: "Illimani", price: "329.00", description: "Botín de cuero con taco bajo, suela antideslizante.", colors: ["Negro", "Café", "Vino", "Gris", "Mostaza"], sizes: [35, 40], costUsd: "21.00", batch: 1 },
  { line: "Caballero", name: "Urbano", price: "349.00", description: "Zapato casual de cuero para el día a día.", colors: ["Negro", "Café", "Azul marino", "Gris", "Beige"], sizes: [39, 44], costUsd: "24.00", batch: 1 },
  { line: "Caballero", name: "Altiplano", price: "459.00", description: "Bota de cuero reforzada, lista para el frío.", colors: ["Café", "Negro", "Miel", "Verde oliva", "Gris"], sizes: [39, 44], costUsd: "31.00", batch: 1 },
  { line: "Caballero", name: "Chaco", price: "289.00", description: "Mocasín liviano (nuevo, aún sin variantes).", colors: [], sizes: [39, 44], costUsd: "19.00", batch: null },
  { line: "Niños", name: "Colegial", price: "169.00", description: "Zapato escolar resistente con cierre de velcro.", colors: ["Negro", "Azul marino", "Café", "Blanco", "Gris"], sizes: [30, 35], costUsd: "11.00", batch: 2 },
  { line: "Niños", name: "Wawa", price: "129.00", description: "Zapatilla blanda para los primeros pasos.", colors: ["Rosado", "Azul marino", "Blanco", "Rojo", "Mostaza", "Gris"], sizes: [22, 27], costUsd: "8.50", batch: 2 },
];

const SEED_NOTE = "Seed demo";

/** Stable pseudo-random number per SKU so reseeding never reshuffles the demo. */
function hashOf(sku: string): number {
  return parseInt(createHash("md5").update(sku).digest("hex").slice(0, 8), 16);
}

type Row<T> = { rows: T[] };

async function one(client: Client, text: string, values: unknown[]): Promise<string> {
  const result = (await client.query(text, values)) as Row<{ id: string }>;
  return result.rows[0].id;
}

async function seedBranches(client: Client): Promise<string> {
  const central = await one(
    client,
    `insert into branches (name, city, active) values ('Central', 'Santa Cruz', true)
     on conflict ((lower(name))) do update set active = true returning id`,
    [],
  );
  await client.query(
    `insert into branches (name, city, active) values ('La Paz', 'La Paz', false)
     on conflict ((lower(name))) do nothing`,
  );
  return central;
}

async function seedUsers(
  client: Client,
  branchId: string,
  users: readonly ResolvedSeedUser[],
): Promise<{ adminId: string; sellerId: string }> {
  let adminId = "";
  let sellerId = "";
  for (const user of users) {
    const hash = await bcrypt.hash(user.password, bcryptCost());
    const id = await one(
      client,
      `insert into users (username, full_name, password_hash, role, branch_id)
       values ($1, $2, $3, $4, $5)
       on conflict ((lower(username))) do update set password_hash = excluded.password_hash, active = true
       returning id`,
      [user.username, user.fullName, hash, user.role, user.role === "seller" ? branchId : null],
    );
    if (user.role === "superadmin") adminId = id;
    else sellerId = id;
  }
  return { adminId, sellerId };
}

interface SeededVariant {
  readonly id: string;
  readonly sku: string;
  readonly model: string;
}

async function seedCatalog(client: Client): Promise<SeededVariant[]> {
  const lineIds = new Map<string, string>();
  for (const name of LINES) {
    const id = await one(
      client,
      `insert into product_lines (name) values ($1)
       on conflict ((lower(name))) do update set name = excluded.name returning id`,
      [name],
    );
    lineIds.set(name, id);
  }
  for (let size = SIZE_RANGE.min; size <= SIZE_RANGE.max; size += 1) {
    await client.query(
      `insert into sizes (label, sort_order) values ($1, $2)
       on conflict (label) do update set sort_order = excluded.sort_order`,
      [String(size), size],
    );
  }
  for (const [name, hex] of COLORS) {
    await client.query("insert into colors (name, hex) values ($1, $2) on conflict ((lower(name))) do nothing", [name, hex]);
  }

  for (const model of MODELS) {
    const modelId = await one(
      client,
      `insert into models (line_id, name, description, base_sale_price) values ($1, $2, $3, $4)
       on conflict (line_id, (lower(name))) do update
         set base_sale_price = excluded.base_sale_price, description = excluded.description returning id`,
      [lineIds.get(model.line), model.name, model.description, model.price],
    );
    if (model.colors.length === 0) continue;
    const colorIds = (await client.query("select id from colors where name = any($1::text[])", [model.colors])) as Row<{ id: string }>;
    const labels = Array.from({ length: model.sizes[1] - model.sizes[0] + 1 }, (_, i) => String(model.sizes[0] + i));
    const sizeIds = (await client.query("select id from sizes where label = any($1::text[])", [labels])) as Row<{ id: string }>;
    await generateVariantsTx(client, {
      modelId,
      colorIds: colorIds.rows.map((r) => r.id),
      sizeIds: sizeIds.rows.map((r) => r.id),
    });
  }

  const names = MODELS.map((m) => m.name);
  const variants = (await client.query(
    `select v.id, v.sku, m.name as model from variants v join models m on m.id = v.model_id
      where m.name = any($1::text[]) order by v.sku`,
    [names],
  )) as Row<SeededVariant>;
  await seedBarcodes(client, variants.rows);
  return variants.rows;
}

/** About a third of the variants already carry the barcode printed on their box. */
async function seedBarcodes(client: Client, variants: readonly SeededVariant[]): Promise<void> {
  for (const variant of variants) {
    const hash = hashOf(variant.sku);
    if (hash % 3 !== 0) continue;
    const barcode = `775${String(hash % 10_000_000_000).padStart(10, "0")}`;
    await client.query(
      `update variants set barcode = $2
        where id = $1 and barcode is null
          and not exists (select 1 from variants o where o.barcode = $2)`,
      [variant.id, barcode],
    );
  }
}

interface BatchPlan {
  readonly supplier: string;
  readonly note: string;
  readonly rate70: string;
  readonly rate30: string;
  readonly split: number;
  readonly freight: number;
  readonly pick: (variant: SeededVariant, model: ModelSeed) => boolean;
}

const BATCHES: readonly BatchPlan[] = [
  {
    supplier: "Calzados Andina SRL",
    note: `${SEED_NOTE} 1: línea Dama y Caballero`,
    rate70: "6.96",
    rate30: "10.50",
    split: 70,
    freight: 150,
    pick: (_variant, model) => model.batch === 1,
  },
  {
    supplier: "Importadora Sur Ltda.",
    note: `${SEED_NOTE} 2: línea Niños y reposición de Alba`,
    rate70: "6.96",
    rate30: "11.20",
    split: 60,
    freight: 90,
    pick: (variant, model) => model.batch === 2 || (model.name === "Alba" && hashOf(variant.sku) % 4 === 0),
  },
];

function batchItems(plan: BatchPlan, variants: readonly SeededVariant[]) {
  const byName = new Map(MODELS.map((model) => [model.name, model]));
  return variants.flatMap((variant) => {
    const model = byName.get(variant.model);
    const hash = hashOf(variant.sku);
    // every 7th variant stays at zero stock so the demo shows "Agotado" too
    if (!model || !plan.pick(variant, model) || hash % 7 === 0) return [];
    return [{ variant_id: variant.id, qty: 1 + (hash % 6), unit_cost_usd: model.costUsd }];
  });
}

/** Same database as `adminUrl`, but through the superadmin runtime login (what the app uses). */
function superadminRuntimeUrl(adminUrl: string): string {
  const raw = process.env.DATABASE_URL_SUPERADMIN;
  if (!raw) throw new Error("Falta DATABASE_URL_SUPERADMIN (necesaria para sembrar las compras).");
  const url = new URL(raw);
  url.pathname = new URL(adminUrl).pathname;
  return url.toString();
}

async function seedStock(
  adminUrl: string,
  adminId: string,
  branchId: string,
  variants: readonly SeededVariant[],
  owner: Client,
): Promise<void> {
  const existing = (await owner.query("select 1 from purchase_batches where notes like $1 limit 1", [`${SEED_NOTE}%`])) as Row<unknown>;
  if (existing.rows.length > 0) return;
  // Purchases are superadmin-only RPCs: run them exactly like the app does (runtime login
  // + signed identity), not as the owner.
  const client = new Client({ connectionString: superadminRuntimeUrl(adminUrl) });
  await client.connect();
  try {
    await client.query("begin");
    await applyUserContext(client, { userId: adminId, role: "superadmin", branchId: null });
    for (const plan of BATCHES) {
      await client.query(
        "select create_purchase_batch($1, $2, current_date, $3, $4, $5, $6, $7, $8::jsonb)",
        [branchId, plan.supplier, plan.rate70, plan.rate30, plan.split, plan.freight, plan.note, JSON.stringify(batchItems(plan, variants))],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function runSeed(databaseUrl: string): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("El seed de desarrollo esta deshabilitado en produccion.");
  }
  const users = resolveSeedUsers();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const branchId = await seedBranches(client);
    const { adminId, sellerId } = await seedUsers(client, branchId, users);
    const variants = await seedCatalog(client);
    await seedStock(databaseUrl, adminId, branchId, variants, client);
    const context = { adminId, sellerId, branchId };
    await seedHistory(databaseUrl, context, client);
    await seedDemo2(databaseUrl, context, client);
    await seedExtras(databaseUrl, context, client);
    await seedStore(databaseUrl, client);
  } finally {
    await client.end();
  }
  say("seed listo. Usuarios de DESARROLLO:");
  for (const user of users) {
    const origin = user.generated
      ? `contrasena generada (se muestra una sola vez): ${user.password}`
      : `contrasena tomada de ${user.passwordEnv}`;
    say(`  ${user.role.padEnd(10)} usuario: ${user.username.padEnd(10)} ${origin}`);
  }
}
