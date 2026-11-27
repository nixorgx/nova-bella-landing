import bcrypt from "bcryptjs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBootstrapConfig, runBootstrap } from "../../scripts/lib/bootstrap";
import { recreateDatabase, runMigrations } from "../../scripts/lib/migrator";
import { ensureDefinerPolicies } from "../../scripts/lib/runtime-roles";
import { WIPE_CONFIRMATION, wipeDemoData } from "../../scripts/lib/wipe";

/** Its own throwaway database: bootstrap and wipe must behave on an empty production-like schema. */
const url = (() => {
  const u = new URL(process.env.TEST_DATABASE_URL as string);
  u.pathname = "/inventario_bootstrap_test";
  return u.toString();
})();

const PASSWORD = "clave-de-prueba-123";
const env = { BOOTSTRAP_SUPERADMIN_PASSWORD: PASSWORD, BOOTSTRAP_SUPERADMIN_USERNAME: "duena.test" };

async function scalar<T>(sql: string, values: unknown[] = []): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, values)).rows[0].v as T;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await recreateDatabase(url);
  await runMigrations(url);
  // Hosts where app_definer has no BYPASSRLS (fallback mode) need its policies, which db:migrate adds after the migrations.
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await ensureDefinerPolicies(client);
  } finally {
    await client.end();
  }
}, 60_000);

afterAll(async () => {
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query('drop database if exists "inventario_bootstrap_test" with (force)');
  await client.end();
});

describe("db:bootstrap", () => {
  it("creates only the superadmin, the branches and default settings, with no demo data", async () => {
    const config = readBootstrapConfig(env);
    const result = await runBootstrap(url, config);
    expect(result).toMatchObject({ adminCreated: true, branchesCreated: ["Central", "La Paz"] });

    expect(await scalar<number>("select count(*)::int as v from users")).toBe(1);
    const admin = await scalar<{ role: string; password_hash: string }>("select row_to_json(u) as v from users u");
    expect(admin.role).toBe("superadmin");
    expect(await bcrypt.compare(PASSWORD, admin.password_hash)).toBe(true);
    expect(await scalar<boolean>("select active as v from branches where name = 'Central'")).toBe(true);
    expect(await scalar<boolean>("select active as v from branches where name = 'La Paz'")).toBe(false);
    for (const table of ["variants", "models", "sales", "stock_movements", "customers", "purchase_batches", "cash_sessions", "exchange_rates"]) {
      expect(await scalar<number>(`select count(*)::int as v from ${table}`), table).toBe(0);
    }
    expect(await scalar<string>("select value as v from app_settings where key = 'target_margin_pct'")).toBe("40");
  });

  it("is idempotent and never overwrites an existing password unless asked", async () => {
    const base = readBootstrapConfig({ ...env, BOOTSTRAP_SUPERADMIN_USERNAME: "duena.test", BOOTSTRAP_SUPERADMIN_PASSWORD: "otra-clave-larga-999" });
    const again = await runBootstrap(url, base);
    expect(again).toEqual({ adminCreated: false, adminPasswordReset: false, branchesCreated: [] });
    const hash = await scalar<string>("select password_hash as v from users");
    expect(await bcrypt.compare(PASSWORD, hash)).toBe(true);

    const reset = await runBootstrap(url, readBootstrapConfig({ ...env, BOOTSTRAP_SUPERADMIN_USERNAME: "duena.test", BOOTSTRAP_SUPERADMIN_PASSWORD: "otra-clave-larga-999" }, ["--reset-password"]));
    expect(reset.adminPasswordReset).toBe(true);
    expect(await bcrypt.compare("otra-clave-larga-999", await scalar<string>("select password_hash as v from users"))).toBe(true);
    expect(await scalar<number>("select count(*)::int as v from branches")).toBe(2);
  });

  it("refuses to take over a username that belongs to a seller", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const branch = (await client.query("select id from branches where name = 'Central'")).rows[0].id;
    await client.query("insert into users (username, full_name, password_hash, role, branch_id) values ('vend.test', 'Vendedor Test', 'x', 'seller', $1)", [branch]);
    await client.end();
    await expect(runBootstrap(url, readBootstrapConfig({ ...env, BOOTSTRAP_SUPERADMIN_USERNAME: "vend.test" }))).rejects.toThrow(/no es superadmin/);
  });
});

describe("db:wipe-demo", () => {
  async function seedDemoRows(): Promise<void> {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const branch = (await client.query("select id from branches where name = 'Central'")).rows[0].id;
      const seller = (await client.query("select id from users where username = 'vend.test'")).rows[0].id;
      const line = (await client.query("insert into product_lines (name) values ('Demo') returning id")).rows[0].id;
      const model = (await client.query("insert into models (line_id, name, base_sale_price) values ($1, 'Demo', 100) returning id", [line])).rows[0].id;
      const color = (await client.query("insert into colors (name) values ('Rojo demo') returning id")).rows[0].id;
      const size = (await client.query("insert into sizes (label, sort_order) values ('99', 99) returning id")).rows[0].id;
      const variant = (await client.query("insert into variants (model_id, color_id, size_id, sku) values ($1, $2, $3, 'DEMO-1') returning id", [model, color, size])).rows[0].id;
      await client.query("insert into stock_movements (variant_id, branch_id, qty, type, created_by) values ($1, $2, 5, 'adjust', $3)", [variant, branch, seller]);
      await client.query("insert into customers (branch_id, name) values ($1, 'Cliente demo')", [branch]);
    } finally {
      await client.end();
    }
  }

  it("empties operational data and sellers but keeps branches, superadmin and settings", async () => {
    await seedDemoRows();
    expect(await scalar<number>("select count(*)::int as v from stock_movements")).toBe(1);
    const result = await wipeDemoData(url, { keepCatalog: false });
    expect(result.sellersRemoved).toBe(1);
    expect(result.tables).toEqual(expect.arrayContaining(["stock_movements", "sales", "variants", "customers", "stock_transfers"]));
    for (const table of ["stock_movements", "stock_levels", "variants", "customers", "models"]) {
      expect(await scalar<number>(`select count(*)::int as v from ${table}`), table).toBe(0);
    }
    expect(await scalar<number>("select count(*)::int as v from users")).toBe(1);
    expect(await scalar<number>("select count(*)::int as v from branches")).toBe(2);
    expect(await scalar<string>("select value as v from app_settings where key = 'target_margin_pct'")).toBe("40");
  });

  it("re-enables the append-only guards afterwards", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await expect(client.query("truncate stock_movements")).rejects.toMatchObject({ code: "IN004" });
      await expect(client.query("truncate stock_transfers")).rejects.toMatchObject({ code: "IN004" });
    } finally {
      await client.end();
    }
  });

  it("can keep the catalog", async () => {
    await runBootstrap(url, readBootstrapConfig({ ...env, BOOTSTRAP_SUPERADMIN_USERNAME: "duena.test" }));
    const branch = await scalar<string>("select id as v from branches where name = 'Central'");
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query("insert into users (username, full_name, password_hash, role, branch_id) values ('vend2.test', 'Vendedor Dos', 'x', 'seller', $1)", [branch]);
    await client.query("insert into colors (name) values ('Azul real')");
    await client.end();
    await wipeDemoData(url, { keepCatalog: true });
    expect(await scalar<number>("select count(*)::int as v from colors")).toBe(1);
    expect(await scalar<number>("select count(*)::int as v from users where role = 'seller'")).toBe(0);
  });

  it("exposes the confirmation word the CLI demands", () => {
    expect(WIPE_CONFIRMATION).toBe("BORRAR-DATOS");
  });
});
