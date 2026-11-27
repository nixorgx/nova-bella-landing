import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import type { VariantHit } from "./types";
import { queryVariants } from "./variant-query";

export const DEFAULT_SEARCH_LIMIT = 12;
export const MAX_SEARCH_LIMIT = 200;
const MAX_TOKENS = 6;
const MAX_QUERY_LENGTH = 80;

export interface SearchOptions {
  readonly query?: string;
  readonly modelId?: string;
  readonly limit?: number;
  /** Honoured for superadmins only; sellers never see inactive items (RLS). */
  readonly includeInactive?: boolean;
  /** Superadmin branch filter. Sellers are always pinned to their own branch. */
  readonly branchId?: string | null;
}

export function tokenize(query: string): string[] {
  return query
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
}

function clampLimit(limit: number | undefined): number {
  const value = Math.floor(limit ?? DEFAULT_SEARCH_LIMIT);
  return Math.min(Math.max(value, 1), MAX_SEARCH_LIMIT);
}

/**
 * Fast lookup across SKU, barcode, model, line, color and size. Every token must
 * match somewhere ("alba negro 38"). It runs under the caller's database role and
 * returns price and stock only: no cost column is ever selected, and cost tables
 * are not even readable by sellers.
 */
export function searchVariants(session: SessionPayload, options: SearchOptions = {}): Promise<VariantHit[]> {
  const isAdmin = session.role === "superadmin";
  const query = options.query ?? "";
  return withUser(session, (client) =>
    queryVariants(client, {
      tokens: tokenize(query),
      rawQuery: query.slice(0, MAX_QUERY_LENGTH),
      modelId: options.modelId,
      includeInactive: isAdmin && options.includeInactive === true,
      branchId: isAdmin ? (options.branchId ?? null) : session.branchId,
      limit: clampLimit(options.limit),
    }),
  );
}

/** Resolves a scanned code against barcode first, then SKU (case-insensitive). */
export async function resolveScan(
  session: SessionPayload,
  code: string,
  branchId: string | null = null,
): Promise<VariantHit | null> {
  const clean = code.trim().slice(0, MAX_QUERY_LENGTH);
  if (!clean) return null;
  const isAdmin = session.role === "superadmin";
  const hits = await withUser(session, (client) =>
    queryVariants(client, {
      code: clean,
      rawQuery: clean,
      includeInactive: isAdmin,
      branchId: isAdmin ? branchId : session.branchId,
      limit: 1,
    }),
  );
  return hits[0] ?? null;
}
