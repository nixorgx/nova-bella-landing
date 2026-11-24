import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import type { TransferPayload } from "./schemas";

/** Calls the transactional create_stock_transfer RPC: every line moves, or none does. */
export async function createTransfer(session: SessionPayload, payload: TransferPayload): Promise<string> {
  const items = payload.items.map((item) => ({ variant_id: item.variantId, qty: item.qtyInput }));
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string }>("select create_stock_transfer($1, $2, $3::jsonb, $4) as id", [
      payload.fromBranchId,
      payload.toBranchId,
      JSON.stringify(items),
      payload.note,
    ]);
    return rows[0].id;
  });
}
