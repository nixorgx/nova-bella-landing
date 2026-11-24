import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { Role, SessionPayload } from "@/lib/auth/session";
import { applyUserContext } from "@/lib/db-context";
import { getPublicDbUrl, getRuntimeDbEnv, type RuntimeDbEnv } from "@/lib/env";

// Keep DATE columns as 'YYYY-MM-DD' strings (no timezone surprises).
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * One pool per least-privilege Postgres login (see migration 009). The pool a request
 * uses is chosen by the session role, so Postgres itself enforces what the connection
 * can do: a seller connection cannot become the superadmin (no SET ROLE / RESET ROLE /
 * SET SESSION AUTHORIZATION escape) nor read the cost tables.
 */
export type PoolKind = Role | "auth" | "public";

const ENV_KEY: Readonly<Record<Exclude<PoolKind, "public">, keyof RuntimeDbEnv>> = {
  seller: "DATABASE_URL_SELLER",
  superadmin: "DATABASE_URL_SUPERADMIN",
  auth: "DATABASE_URL_AUTH",
};

function connectionStringFor(kind: PoolKind): string {
  return kind === "public" ? getPublicDbUrl() : getRuntimeDbEnv()[ENV_KEY[kind]];
}

const POOL_MAX = 10;
const POOL_IDLE_MS = 30_000;

const globalForPools = globalThis as unknown as {
  __inventarioPools?: Partial<Record<PoolKind, Pool>>;
};

/** Pools survive Next.js hot reloads in dev. */
export function getPool(kind: PoolKind): Pool {
  const pools = (globalForPools.__inventarioPools ??= {});
  const existing = pools[kind];
  if (existing) return existing;
  const connectionString = connectionStringFor(kind);
  // Supavisor's TLS chain is signed by Supabase's own root CA. A bundled Node.js
  // trust store does not recognize it, so configure the explicit CA in Vercel.
  // Retain certificate + hostname verification: never disable rejectUnauthorized.
  const suppliedCa = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  let ssl: { ca: string; rejectUnauthorized: true } | undefined;
  const url = new URL(connectionString);
  // The Supabase shared pooler routes connections by [role].[project-ref].
  // Direct connections use the plain role. Keep the secret and password intact.
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    const ref = process.env.SUPABASE_PROJECT_REF?.trim();
    if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
      throw new Error("SUPABASE_PROJECT_REF no configurado para pooler");
    }
    const role = decodeURIComponent(url.username);
    if (!role.endsWith(`.${ref}`)) {
      if (role.includes(".")) throw new Error("La conexión PostgreSQL apunta a otro proyecto Supabase");
      url.username = `${role}.${ref}`;
    }
  }
  if (suppliedCa) {
    if (!url.hostname.endsWith(".supabase.com") && !url.hostname.endsWith(".supabase.co")) {
      throw new Error("Certificado Supabase configurado para un servidor no Supabase");
    }
    if (!suppliedCa.includes("-----BEGIN CERTIFICATE-----") || !suppliedCa.includes("-----END CERTIFICATE-----")) {
      throw new Error("Certificado raíz de Supabase inválido");
    }
    // node-postgres replaces the ssl object whenever sslmode/sslrootcert is
    // supplied in the URL. Strip only TLS query flags before passing ssl.ca.
    for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) {
      url.searchParams.delete(key);
    }
    ssl = { ca: suppliedCa, rejectUnauthorized: true };
  }
  const safeConnectionString = url.toString();
  const pool = new Pool({
    connectionString: safeConnectionString,
    ...(ssl ? { ssl } : {}),
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_MS,
  });
  pools[kind] = pool;
  return pool;
}

export async function closePools(): Promise<void> {
  const pools = globalForPools.__inventarioPools;
  globalForPools.__inventarioPools = undefined;
  await Promise.all(Object.values(pools ?? {}).map((pool) => pool.end()));
}

async function inTransaction<T>(
  kind: PoolKind,
  prepare: ((client: PoolClient) => Promise<void>) | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool(kind).connect();
  let discard = false;
  try {
    await client.query("begin");
    if (prepare) await prepare(client);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    // If even ROLLBACK fails the connection is in an unknown state: destroy it
    // instead of returning it to the pool.
    await client.query("rollback").catch(() => {
      discard = true;
    });
    throw error;
  } finally {
    client.release(discard);
  }
}

/**
 * Runs `fn` in a transaction on the pool that matches the user's role, with the user's
 * signed identity published (RLS + GRANTs apply). This is the ONLY way request code
 * should read or write business data.
 */
export function withUser<T>(
  session: SessionPayload,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (session.role !== "seller" && session.role !== "superadmin") {
    return Promise.reject(new Error("Rol de sesion invalido"));
  }
  return inTransaction(session.role, (client) => applyUserContext(client, session), fn);
}

/**
 * Authentication lookups (login, session re-validation). Runs as `app_runtime_auth`,
 * which can ONLY execute the auth_* functions: no table access at all.
 */
export async function authQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<R>> {
  return getPool("auth").query<R>(text, values);
}

/**
 * Anonymous store traffic. Runs as `app_runtime_public`, which has NO table privileges: it can only
 * execute the public_*() SECURITY DEFINER functions. Each call is one self-contained statement.
 */
export async function publicQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<R>> {
  return getPool("public").query<R>(text, values);
}
