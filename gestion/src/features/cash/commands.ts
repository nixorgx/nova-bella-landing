import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { dec, parseMoney } from "@/lib/money";
import { cashClosing } from "./cash-math";
import { readSummary, type CashSummary } from "./queries";

/** Raised with a message that is safe to show to the user. */
export class CashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashError";
  }
}

const MAX_AMOUNT = 9_999_999.99;

export function readAmount(input: string, label: string): string {
  const parsed = input.trim() === "" ? "0.00" : parseMoney(input);
  if (parsed === null || dec(parsed).isNegative() || dec(parsed).gt(MAX_AMOUNT)) {
    throw new CashError(`${label} debe ser un monto en Bs (ej. 200,00).`);
  }
  return parsed;
}

/** Opens the branch's cash session. One open session per branch is enforced by the database. */
export async function openCashSession(
  session: SessionPayload,
  branchId: string,
  openingInput: string,
): Promise<string> {
  const opening = readAmount(openingInput, "El monto de apertura");
  try {
    return await withUser(session, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "insert into cash_sessions (branch_id, opened_by, opening_amount) values ($1, $2, $3) returning id",
        [branchId, session.userId, opening],
      );
      return rows[0].id;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new CashError("Ya hay una caja abierta en esta sucursal.");
    }
    throw error;
  }
}

export interface ClosedCash {
  readonly expected: string;
  readonly counted: string;
  readonly difference: string;
  readonly summary: CashSummary;
}

/** Closes the session with the counted cash and reports expected vs counted. */
export async function closeCashSession(
  session: SessionPayload,
  sessionId: string,
  countedInput: string,
): Promise<ClosedCash> {
  const counted = readAmount(countedInput, "El efectivo contado");
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string; opening_amount: string }>(
      "update cash_sessions set closed_at = now(), closing_amount = $2 where id = $1 and closed_at is null returning id, opening_amount",
      [sessionId, counted],
    );
    if (rows.length === 0) throw new CashError("La caja ya estaba cerrada o no existe.");
    const summary = await readSummary(client, { id: sessionId, openingAmount: rows[0].opening_amount });
    const result = cashClosing({
      openingAmount: rows[0].opening_amount,
      cashSales: summary.byMethod.efectivo,
      cashExchangeNet: summary.exchangeByMethod.efectivo,
      counted,
    });
    return { expected: result.expected, counted, difference: result.difference ?? "0.00", summary };
  });
}
