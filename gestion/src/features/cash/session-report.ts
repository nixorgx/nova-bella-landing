import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { toMoney } from "@/lib/money";
import { buildPage, clampPage, type Page, type PageRequest } from "@/lib/pagination";
import { mergeByMethod, type MethodRow } from "@/features/reports/aggregate";
import { PAYMENT_METHODS, type PaymentMethod } from "@/features/sales/payments";
import { cashClosing } from "./cash-math";
import { SESSION_REPORT_SELECT } from "./session-sql";

export interface CashSessionReport {
  readonly id: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly openedBy: string;
  readonly openedByName: string | null;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly openingAmount: string;
  readonly closingAmount: string | null;
  readonly salesCount: number;
  readonly salesTotal: string;
  /** Per method: sales, exchange differences and the net collected. */
  readonly methods: readonly MethodRow[];
  readonly exchangeCount: number;
  readonly voidCount: number;
  readonly voidTotal: string;
  /** opening + cash sales + cash collected - cash refunded in exchanges. */
  readonly expectedCash: string;
  /** counted - expected; null while the session is open. */
  readonly difference: string | null;
  readonly status: "open" | "closed";
}

export interface CashSessionFilters {
  readonly from?: string;
  readonly to?: string;
  readonly branchId?: string;
  readonly openedBy?: string;
}

type Raw = Record<string, string | number | Date | null>;

function methodMap(row: Raw, prefix: string): Record<PaymentMethod, string> {
  const pick = (method: PaymentMethod) => String(row[`${prefix}_${method}`] ?? "0");
  return { efectivo: pick("efectivo"), qr: pick("qr"), transferencia: pick("transferencia"), tarjeta: pick("tarjeta") };
}

export function mapSessionReport(row: Raw): CashSessionReport {
  const methods = mergeByMethod(methodMap(row, "pay"), methodMap(row, "ex"));
  const cash = methods.find((m) => m.method === "efectivo") as MethodRow;
  const opening = String(row.opening_amount);
  const closing = row.closing_amount === null ? null : String(row.closing_amount);
  const closed = cashClosing({ openingAmount: opening, cashSales: cash.sales, cashExchangeNet: cash.exchanges, counted: closing ?? "" });
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    branchName: String(row.branch_name),
    openedBy: String(row.opened_by),
    openedByName: row.opened_by_name === null ? null : String(row.opened_by_name),
    openedAt: (row.opened_at as Date).toISOString(),
    closedAt: row.closed_at ? (row.closed_at as Date).toISOString() : null,
    openingAmount: toMoney(opening),
    closingAmount: closing === null ? null : toMoney(closing),
    salesCount: Number(row.sales_count),
    salesTotal: toMoney(String(row.sales_total)),
    methods,
    exchangeCount: Number(row.exchange_count),
    voidCount: Number(row.void_count),
    voidTotal: toMoney(String(row.void_total)),
    expectedCash: closed.expected,
    difference: closing === null ? null : closed.difference,
    status: row.closed_at ? "closed" : "open",
  };
}

const TZ = "America/La_Paz";

function whereFor(filters: CashSessionFilters): { clause: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const add = (sql: (p: string) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(`$${values.length}`));
  };
  if (filters.from) add((p) => `cs.opened_at >= (${p}::date)::timestamp at time zone '${TZ}'`, filters.from);
  if (filters.to) add((p) => `cs.opened_at < ((${p}::date) + 1)::timestamp at time zone '${TZ}'`, filters.to);
  if (filters.branchId) add((p) => `cs.branch_id = ${p}::uuid`, filters.branchId);
  if (filters.openedBy) add((p) => `cs.opened_by = ${p}::uuid`, filters.openedBy);
  return { clause: conditions.length ? `where ${conditions.join(" and ")}` : "", values };
}

/**
 * Cash sessions the caller may see (RLS pins a seller to the branch). A seller is additionally
 * narrowed to the sessions they opened: the superadmin's filters never apply to sellers.
 */
function scoped(session: SessionPayload, filters: CashSessionFilters): CashSessionFilters {
  return session.role === "seller"
    ? { from: filters.from, to: filters.to, branchId: session.branchId ?? undefined, openedBy: session.userId }
    : filters;
}

export async function listCashSessions(
  session: SessionPayload,
  filters: CashSessionFilters,
  request: PageRequest,
): Promise<Page<CashSessionReport>> {
  const { clause, values } = whereFor(scoped(session, filters));
  return withUser(session, async (client) => {
    const counted = await client.query<{ total: number }>(
      `select count(*)::int as total from cash_sessions cs ${clause}`,
      values,
    );
    const total = counted.rows[0].total;
    const page = clampPage(request.page, total, request.pageSize);
    const { rows } = await client.query(
      `${SESSION_REPORT_SELECT} ${clause}
        order by cs.opened_at desc limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, request.pageSize, (page - 1) * request.pageSize],
    );
    return buildPage(rows.map(mapSessionReport), total, { page, pageSize: request.pageSize });
  });
}

/** Every session matching the filters, bounded (exports). */
export async function listCashSessionsForExport(
  session: SessionPayload,
  filters: CashSessionFilters,
  limit: number,
): Promise<CashSessionReport[]> {
  const { clause, values } = whereFor(scoped(session, filters));
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `${SESSION_REPORT_SELECT} ${clause} order by cs.opened_at limit $${values.length + 1}`,
      [...values, limit],
    );
    return rows.map(mapSessionReport);
  });
}

export async function getCashSessionReport(session: SessionPayload, id: string): Promise<CashSessionReport | null> {
  const scope = scoped(session, {});
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `${SESSION_REPORT_SELECT} where cs.id = $1 and ($2::uuid is null or cs.opened_by = $2::uuid)`,
      [id, scope.openedBy ?? null],
    );
    return rows[0] ? mapSessionReport(rows[0]) : null;
  });
}

export interface SessionSaleRow {
  readonly id: string;
  readonly saleNumber: number;
  readonly createdAt: string;
  readonly status: "completed" | "voided";
  readonly total: string;
  readonly sellerName: string | null;
  readonly customerName: string | null;
  readonly voidReason: string | null;
  readonly methods: readonly PaymentMethod[];
}

export async function listSessionSales(session: SessionPayload, sessionId: string): Promise<SessionSaleRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select s.id, s.sale_number, s.created_at, s.status, s.total::text as total, td.full_name as seller_name,
              c.name as customer_name, s.void_reason,
              (select string_agg(distinct p.method, ',' order by p.method) from sale_payments p where p.sale_id = s.id) as methods
         from sales s
         left join team_directory() td on td.id = s.seller_id
         left join customers c on c.id = s.customer_id
        where s.cash_session_id = $1 order by s.created_at, s.sale_number`,
      [sessionId],
    );
    return rows.map((row) => ({
      id: row.id,
      saleNumber: Number(row.sale_number),
      createdAt: row.created_at.toISOString(),
      status: row.status,
      total: row.total,
      sellerName: row.seller_name,
      customerName: row.customer_name,
      voidReason: row.void_reason,
      methods: row.methods ? (row.methods.split(",") as PaymentMethod[]) : [],
    }));
  });
}

export interface SessionExchangeRow {
  readonly id: string;
  readonly createdAt: string;
  readonly saleNumber: number;
  readonly saleId: string;
  readonly summary: string;
  readonly priceDiff: string;
  readonly method: PaymentMethod | null;
}

export async function listSessionExchanges(session: SessionPayload, sessionId: string): Promise<SessionExchangeRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select e.id, e.created_at, s.sale_number, s.id as sale_id, e.price_diff::text as price_diff, e.payment_method,
              e.qty || ' × ' || rm.name || ' T' || rz.label || ' → ' || nm.name || ' T' || nz.label as summary
         from exchanges e
         join sales s on s.id = e.original_sale_id
         join variants rv on rv.id = e.returned_variant_id join models rm on rm.id = rv.model_id join sizes rz on rz.id = rv.size_id
         join variants nv on nv.id = e.new_variant_id join models nm on nm.id = nv.model_id join sizes nz on nz.id = nv.size_id
        where e.cash_session_id = $1 order by e.created_at`,
      [sessionId],
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      saleNumber: Number(row.sale_number),
      saleId: row.sale_id,
      summary: row.summary,
      priceDiff: row.price_diff,
      method: row.payment_method,
    }));
  });
}

export const METHODS_IN_ORDER = PAYMENT_METHODS;

/** Sessions that are open right now (every branch the caller can see), with their running totals. */
export async function listOpenSessionReports(session: SessionPayload, branchId: string | null = null): Promise<CashSessionReport[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `${SESSION_REPORT_SELECT} where cs.closed_at is null and ($1::uuid is null or cs.branch_id = $1::uuid) order by cs.opened_at`,
      [branchId],
    );
    return rows.map(mapSessionReport);
  });
}

export interface CashierOption {
  readonly id: string;
  readonly name: string;
}

/** People who have opened a cash session (for the superadmin's filter). */
export async function listCashiers(session: SessionPayload): Promise<CashierOption[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string; full_name: string }>(
      `select t.id, t.full_name from team_directory() t
        where t.id in (select opened_by from cash_sessions) order by t.full_name`,
    );
    return rows.map((row) => ({ id: row.id, name: row.full_name }));
  });
}
