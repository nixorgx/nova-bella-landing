import { createHmac } from "node:crypto";
import type { SessionPayload } from "@/lib/auth/session";
import { getContextSecret } from "@/lib/env";

export interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
}

/** Name of the transaction-local setting that carries the signed identity. */
export const CONTEXT_SETTING = "app.ctx";
/** The token only needs to outlive the transaction that carries it. */
export const CONTEXT_TTL_SECONDS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NO_BRANCH = "-";

/**
 * Builds the request identity token `userId.branchId|-.expiry.hmac` that the database
 * verifies (app_private.verified_context). A database connection cannot mint one:
 * the secret lives only in the app environment and in a table the runtime roles
 * cannot read. Format and algorithm MUST stay in sync with migration 009.
 */
export function signContext(
  session: Pick<SessionPayload, "userId" | "branchId">,
  secret: string,
  nowMs: number = Date.now(),
  ttlSeconds: number = CONTEXT_TTL_SECONDS,
): string {
  const userId = session.userId.toLowerCase();
  const branchId = session.branchId ? session.branchId.toLowerCase() : NO_BRANCH;
  if (!UUID.test(userId) || (branchId !== NO_BRANCH && !UUID.test(branchId))) {
    throw new Error("Identidad de sesion invalida");
  }
  const expires = Math.floor(nowMs / 1000) + ttlSeconds;
  const signature = createHmac("sha256", secret).update(`${userId}|${branchId}|${expires}`).digest("hex");
  return `${userId}.${branchId}.${expires}.${signature}`;
}

/**
 * Publishes the signed identity to RLS policies / RPC functions. MUST run inside an
 * open transaction (set_config(..., true) is transaction scoped). The privilege role
 * is not selected here: it is fixed by the pool (login role) the transaction runs on.
 */
export async function applyUserContext(client: Queryable, session: SessionPayload): Promise<void> {
  const token = signContext(session, getContextSecret());
  await client.query(`select set_config('${CONTEXT_SETTING}', $1, true)`, [token]);
}
