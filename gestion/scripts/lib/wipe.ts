import { Client } from "pg";

/** Always kept: the structure of the deployment itself. Sellers and superadmins are handled apart. */
const KEEP_ALWAYS = ["branches", "users", "app_settings", "schema_migrations"] as const;
const CATALOG_TABLES = ["product_lines", "models", "colors", "sizes", "variants"] as const;
export const WIPE_CONFIRMATION = "BORRAR-DATOS";

export interface WipeOptions {
  /** Keep lines, models, colors, sizes and variants (useful when the real catalog is already loaded). */
  readonly keepCatalog: boolean;
}

export interface WipeResult {
  readonly tables: readonly string[];
  readonly sellersRemoved: number;
}

/**
 * Removes demo/operational data: sales, stock, purchases, exchanges, cash, customers, transfers and
 * (unless kept) the catalog, plus every seller account. Keeps branches, superadmins, settings and
 * the migration history. Runs in ONE transaction, as the table owner (no superuser needed): the two
 * append-only TRUNCATE guards are disabled for the statement and enabled again before commit.
 */
export async function wipeDemoData(databaseUrl: string, options: WipeOptions): Promise<WipeResult> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    const keep = new Set<string>([...KEEP_ALWAYS, ...(options.keepCatalog ? CATALOG_TABLES : [])]);
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    const tables = rows.map((row) => row.tablename).filter((name) => !keep.has(name));
    if (tables.length === 0) throw new Error("No se encontraron tablas para limpiar.");

    const guards = await client.query<{ tgname: string; table_name: string }>(
      `select t.tgname, c.relname as table_name
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and (t.tgtype & 32) <> 0 and c.relname = any($1::text[])`,
      [tables],
    );
    const quoted = tables.map((name) => `"${name}"`).join(", ");
    for (const guard of guards.rows) await client.query(`alter table "${guard.table_name}" disable trigger "${guard.tgname}"`);
    await client.query(`truncate table ${quoted} restart identity`);
    for (const guard of guards.rows) await client.query(`alter table "${guard.table_name}" enable trigger "${guard.tgname}"`);

    const removed = await client.query("delete from users where role = 'seller'");
    await client.query("commit");
    return { tables, sellersRemoved: removed.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
