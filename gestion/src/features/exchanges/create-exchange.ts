import { randomUUID } from "node:crypto";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { exchangeReasonText } from "./reasons";
import type { ExchangeInput } from "./schemas";

export interface CreatedExchange {
  readonly groupId: string;
  readonly exchangeIds: readonly string[];
}

/**
 * Confirms an exchange through create_exchange: one call per line inside ONE transaction, so
 * either every line is exchanged (stock in/out, difference settled through the open cash
 * session) or nothing is. The database computes the price difference; only the superadmin's
 * manual override is forwarded (and the database re-checks its bounds).
 */
export async function createExchange(session: SessionPayload, input: ExchangeInput): Promise<CreatedExchange> {
  const groupId = randomUUID();
  const reason = exchangeReasonText(input.reason, input.note);
  const exchangeIds = await withUser(session, async (client) => {
    const ids: string[] = [];
    for (const line of input.lines) {
      const override = session.role === "superadmin" ? (line.priceDiffOverride ?? null) : null;
      const { rows } = await client.query<{ id: string }>(
        "select create_exchange($1, $2, $3, $4, $5, $6, $7, $8) as id",
        [input.saleId, line.returnedVariantId, line.newVariantId, line.qty, reason, override, input.paymentMethod ?? null, groupId],
      );
      ids.push(rows[0].id);
    }
    return ids;
  });
  return { groupId, exchangeIds };
}
