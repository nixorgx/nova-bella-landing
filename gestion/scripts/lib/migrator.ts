import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { prepareDefinerRole, revokeDefinerCreate } from "./runtime-roles";

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");
const MIGRATION_LOCK_ID = 727_001;

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

function readMigrations(dir: string): readonly MigrationFile[] {
  return readdirSync(dir)
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

async function ensureTable(client: Client): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
}

async function applyOne(client: Client, migration: MigrationFile): Promise<void> {
  await client.query("begin");
  try {
    await client.query(migration.sql);
    await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
      migration.name,
      migration.checksum,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw new Error(`Migracion ${migration.name} fallo: ${(error as Error).message}`);
  }
}

/** Applies pending migrations in filename order, each in its own transaction. */
export async function runMigrations(
  databaseUrl: string,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await ensureTable(client);
    await prepareDefinerRole(client);
    const done = await client.query<{ name: string; checksum: string }>(
      "select name, checksum from schema_migrations",
    );
    const known = new Map(done.rows.map((row) => [row.name, row.checksum]));

    for (const migration of readMigrations(dir)) {
      const previous = known.get(migration.name);
      if (previous === undefined) {
        await applyOne(client, migration);
        applied.push(migration.name);
      } else if (previous !== migration.checksum) {
        throw new Error(
          `La migracion ${migration.name} ya fue aplicada pero su contenido cambio. Cree una nueva migracion.`,
        );
      } else {
        skipped.push(migration.name);
      }
    }
  } finally {
    await revokeDefinerCreate(client).catch(() => undefined);
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
  return { applied, skipped };
}

function parseUrl(databaseUrl: string): { admin: string; name: string } {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error("Nombre de base de datos invalido");
  }
  url.pathname = "/postgres";
  return { admin: url.toString(), name };
}

/** Drops and recreates the database named in the URL (local development/test only). */
export async function recreateDatabase(databaseUrl: string): Promise<void> {
  const { admin, name } = parseUrl(databaseUrl);
  const client = new Client({ connectionString: admin });
  await client.connect();
  try {
    await client.query(`drop database if exists "${name}" with (force)`);
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

export function isLocalDatabase(databaseUrl: string): boolean {
  const host = new URL(databaseUrl).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
