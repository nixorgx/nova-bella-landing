import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

// Same DATE handling as the app pools.
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * Owner/superuser access to the TEST database, for fixtures and assertions only.
 * Deliberately NOT part of src/: request code has no owner-level door.
 */
const globalForSystem = globalThis as unknown as { __systemPool?: Pool };

function systemPool(): Pool {
  globalForSystem.__systemPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return globalForSystem.__systemPool;
}

export async function systemQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<R>> {
  return systemPool().query<R>(text, values);
}

export async function withSystem<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await systemPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface ImpersonationSession {
  readonly userId: string;
  readonly branchId: string | null;
  readonly role: "seller" | "superadmin";
}

/**
 * Runs `fn` as the runtime login of `session` INSIDE a transaction that is always rolled
 * back. A superuser may `SET SESSION AUTHORIZATION`, so session_user (what app_role() reads)
 * becomes the runtime role, while the same connection can first change global settings that
 * would otherwise leak into tests running in parallel. Test-only: the app has no such door.
 */
export async function inRolledBackTx<T>(
  session: ImpersonationSession,
  prepare: (client: PoolClient) => Promise<void>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const { signContext } = await import("@/lib/db-context");
  const { getContextSecret } = await import("@/lib/env");
  const client = await systemPool().connect();
  try {
    await client.query("begin");
    await prepare(client);
    await client.query(`set local session authorization ${session.role === "seller" ? "app_runtime_seller" : "app_runtime_superadmin"}`);
    await client.query("select set_config('app.ctx', $1, true)", [signContext(session, getContextSecret())]);
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
