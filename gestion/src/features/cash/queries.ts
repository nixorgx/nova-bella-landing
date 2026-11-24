import type { SessionPayload } from "@/lib/auth/session";
import type { PoolClient } from "pg";
import { withUser } from "@/lib/db";
import { toMoney } from "@/lib/money";
import { cashClosing, type ClosingResult } from "./cash-math";
import { SALE_COUNTS_IN_SESSION } from "./session-sql";
import type { PaymentMethod } from "@/features/sales/payments";

export interface CashSessionInfo {
  readonly id: string;
  readonly branchId: string;
  readonly openedAt: string;
  readonly openedByName: string | null;
  readonly openingAmount: string;
  readonly closedAt: string | null;
  readonly closingAmount: string | null;
  /** Cash payments of its sales (for the expected-vs-counted difference). */
  readonly cashSales: string;
  /** Cash collected (+) minus cash refunded (-) by exchanges that went through this session. */
  readonly cashExchangeNet: string;
}

export interface CashSummary {
  readonly salesCount: number;
  readonly salesTotal: string;
  readonly byMethod: Readonly<Record<PaymentMethod, string>>;
  /** Exchange differences per method (collected +, refunded -). */
  readonly exchangeByMethod: Readonly<Record<PaymentMethod, string>>;
  readonly voidCount: number;
  readonly expectedCash: string;
}

interface SessionRow {
  id: string;
  branch_id: string;
  opened_at: Date;
  opened_by_name: string | null;
  opening_amount: string;
  closed_at: Date | null;
  closing_amount: string | null;
  cash_sales: string;
  cash_exchange_net: string;
}

const SESSION_SELECT = `
  select cs.id, cs.branch_id, cs.opened_at, td.full_name as opened_by_name,
         cs.opening_amount, cs.closed_at, cs.closing_amount,
         (select coalesce(sum(p.amount), 0)::text from sale_payments p join sales s on s.id = p.sale_id
           where s.cash_session_id = cs.id and ${SALE_COUNTS_IN_SESSION} and p.method = 'efectivo') as cash_sales,
         (select coalesce(sum(e.price_diff), 0)::text from exchanges e
           where e.cash_session_id = cs.id and e.payment_method = 'efectivo') as cash_exchange_net
    from cash_sessions cs
    left join team_directory() td on td.id = cs.opened_by`;

function mapSession(row: SessionRow): CashSessionInfo {
  return {
    id: row.id,
    branchId: row.branch_id,
    openedAt: row.opened_at.toISOString(),
    openedByName: row.opened_by_name,
    openingAmount: row.opening_amount,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    closingAmount: row.closing_amount,
    cashSales: toMoney(row.cash_sales),
    cashExchangeNet: toMoney(row.cash_exchange_net),
  };
}

export async function getOpenSession(session: SessionPayload, branchId: string): Promise<CashSessionInfo | null> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<SessionRow>(
      `${SESSION_SELECT} where cs.branch_id = $1 and cs.closed_at is null limit 1`,
      [branchId],
    );
    return rows[0] ? mapSession(rows[0]) : null;
  });
}

export async function listRecentSessions(
  session: SessionPayload,
  branchId: string,
  limit = 8,
): Promise<CashSessionInfo[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<SessionRow>(
      `${SESSION_SELECT} where cs.branch_id = $1 and cs.closed_at is not null
        order by cs.opened_at desc limit $2`,
      [branchId, limit],
    );
    return rows.map(mapSession);
  });
}

const EMPTY_METHODS: Record<PaymentMethod, string> = { efectivo: "0.00", qr: "0.00", transferencia: "0.00", tarjeta: "0.00" };

/** Money taken in a session by method (voided sales excluded) and the cash expected in the drawer. */
export function getCashSummary(
  session: SessionPayload,
  cash: Pick<CashSessionInfo, "id" | "openingAmount">,
): Promise<CashSummary> {
  return withUser(session, (client) => readSummary(client, cash));
}

export async function readSummary(
  client: PoolClient,
  cash: Pick<CashSessionInfo, "id" | "openingAmount">,
): Promise<CashSummary> {
  const totals = await client.query<{ count: number; total: string }>(
    `select count(*)::int as count, coalesce(sum(s.total), 0)::text as total
       from sales s join cash_sessions cs on cs.id = s.cash_session_id
      where cs.id = $1 and ${SALE_COUNTS_IN_SESSION}`,
    [cash.id],
  );
  const methods = await client.query<{ method: PaymentMethod; amount: string }>(
    `select p.method, sum(p.amount)::text as amount
       from sale_payments p join sales s on s.id = p.sale_id join cash_sessions cs on cs.id = s.cash_session_id
      where cs.id = $1 and ${SALE_COUNTS_IN_SESSION}
      group by p.method`,
    [cash.id],
  );
  const exchanges = await client.query<{ method: PaymentMethod; amount: string }>(
    `select payment_method as method, sum(price_diff)::text as amount
       from exchanges where cash_session_id = $1 and payment_method is not null group by payment_method`,
    [cash.id],
  );
  const voids = await client.query<{ count: number }>(
    "select count(*)::int as count from sales where cash_session_id = $1 and status = 'voided'",
    [cash.id],
  );
  const byMethod = { ...EMPTY_METHODS };
  for (const row of methods.rows) byMethod[row.method] = toMoney(row.amount);
  const exchangeByMethod = { ...EMPTY_METHODS };
  for (const row of exchanges.rows) exchangeByMethod[row.method] = toMoney(row.amount);
  return {
    salesCount: totals.rows[0].count,
    salesTotal: toMoney(totals.rows[0].total),
    byMethod,
    exchangeByMethod,
    voidCount: voids.rows[0].count,
    expectedCash: cashClosing({
      openingAmount: cash.openingAmount,
      cashSales: byMethod.efectivo,
      cashExchangeNet: exchangeByMethod.efectivo,
      counted: "",
    }).expected,
  };
}

export type { ClosingResult };
