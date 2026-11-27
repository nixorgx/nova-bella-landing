import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import type { VoidSaleInput } from "./void-schema";

/**
 * Voids a sale through void_sale (superadmin only, enforced by the database too): the sale stays
 * on record, its stock comes back with inverse 'void' movements, and the reason is stored.
 * Sales with exchanges are refused by the database (IN005).
 */
export async function voidSale(session: SessionPayload, input: VoidSaleInput): Promise<void> {
  await withUser(session, (client) => client.query("select void_sale($1, $2)", [input.saleId, input.reason]));
}
