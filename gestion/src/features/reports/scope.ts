import type { SessionPayload } from "@/lib/auth/session";
import { one, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { resolvePeriod, type DateRange, type ResolvedPeriod } from "./period";

/** What every report query is limited to. Built here so the role rules live in ONE place. */
export interface ReportScope extends DateRange {
  readonly branchId: string | null;
  /** Sales of one seller only ("mis ventas" for sellers; optional filter for the superadmin). */
  readonly sellerId: string | null;
  /** Sales channel: "store" (counter / POS), "web" (online store) or null for both. */
  readonly channel: SalesChannel | null;
}

export type SalesChannel = "store" | "web";
export const CHANNEL_LABEL: Readonly<Record<SalesChannel, string>> = { store: "Tienda física", web: "Tienda web" };

/**
 * Sellers are pinned to their own branch AND their own sales, whatever the URL says; the superadmin
 * may filter by branch and seller. The database (RLS) enforces the branch part again.
 */
export function scopeFor(
  session: SessionPayload,
  range: DateRange,
  requested: { branchId?: string | null; sellerId?: string | null; channel?: SalesChannel | null } = {},
): ReportScope {
  if (session.role === "seller") {
    // A seller's own sales are counter sales: web sales are booked under the superadmin who confirmed them.
    return { from: range.from, to: range.to, branchId: session.branchId, sellerId: session.userId, channel: requested.channel ?? null };
  }
  return { from: range.from, to: range.to, branchId: requested.branchId ?? null, sellerId: requested.sellerId ?? null, channel: requested.channel ?? null };
}

export interface ReportFilters {
  readonly period: ResolvedPeriod;
  readonly branchId: string | null;
  readonly sellerId: string | null;
  readonly channel: SalesChannel | null;
}

/** Reads ?periodo= &desde= &hasta= &sucursal= &vendedor= (shareable links; bad values fall back safely). */
export function readReportFilters(params: RawSearchParams, today?: string): ReportFilters {
  return {
    period: resolvePeriod(params, today),
    branchId: uuidParam(params.sucursal) ?? null,
    sellerId: uuidParam(params.vendedor) ?? null,
    channel: one(params.canal) === "web" ? "web" : one(params.canal) === "tienda" ? "store" : null,
  };
}

/** The same filters as URL parameters (for links, tabs and export buttons). */
export function filterQuery(filters: ReportFilters, extra: Readonly<Record<string, string | undefined>> = {}): string {
  const query = new URLSearchParams();
  query.set("periodo", filters.period.kind);
  if (filters.period.kind === "rango") {
    query.set("desde", filters.period.from);
    query.set("hasta", filters.period.to);
  }
  if (filters.branchId) query.set("sucursal", filters.branchId);
  if (filters.sellerId) query.set("vendedor", filters.sellerId);
  if (filters.channel) query.set("canal", filters.channel === "web" ? "web" : "tienda");
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  return query.toString();
}

export const viewParam = (params: RawSearchParams): string | undefined => one(params.vista);

/** Positional parameters shared by every report SQL: [from, to, branch, seller, channel]. */
export const scopeValues = (scope: ReportScope): [string, string, string | null, string | null, string | null] => [
  scope.from,
  scope.to,
  scope.branchId,
  scope.sellerId,
  scope.channel,
];

const TZ = "America/La_Paz";

/** Condition on `ts` (timestamptz) for the scope's dates; uses $1, $2. */
export const inRangeSql = (ts: string): string =>
  `${ts} >= ($1::date)::timestamp at time zone '${TZ}' and ${ts} < (($2::date) + 1)::timestamp at time zone '${TZ}'`;

/**
 * Branch / seller / channel conditions; uses $3, $4, $5. `branchCol` and `sellerCol` are column references;
 * the channel column lives on the same `sales` alias as the seller column (`s.seller_id` -> `s.channel`).
 */
export const ownerSql = (branchCol: string, sellerCol: string): string =>
  `($3::uuid is null or ${branchCol} = $3::uuid) and ($4::uuid is null or ${sellerCol} = $4::uuid)` +
  ` and ($5::text is null or ${sellerCol.replace(/seller_id$/, "channel")} = $5::text)`;

export const LA_PAZ = TZ;
