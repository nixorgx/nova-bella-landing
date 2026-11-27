import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import type { SaleInput } from "./schemas";

/** Raised with a message that is safe to show to the user. */
export class SaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleError";
  }
}

/** Sellers always sell in their own branch; the superadmin must say which one. */
export function resolveSaleBranch(session: SessionPayload, requested: string | null | undefined): string {
  const branchId = session.role === "seller" ? session.branchId : (requested ?? null);
  if (!branchId) throw new SaleError("Seleccione la sucursal de la venta.");
  return branchId;
}

/**
 * Confirms a sale through the transactional create_sale RPC (sale + items + payments +
 * stock movements, or nothing). The database re-checks everything: stock, open cash session,
 * the seller discount floor and payments == total. Returns the new sale id.
 */
export async function createSale(session: SessionPayload, input: SaleInput): Promise<string> {
  const branchId = resolveSaleBranch(session, input.branchId);
  const items = input.items.map((item) => ({
    variant_id: item.variantId,
    qty: item.qty,
    final_price: item.finalPrice,
  }));
  const payments = input.payments.map((payment) => ({ method: payment.method, amount: payment.amount }));

  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select create_sale($1, $2, $3, $4::jsonb, $5::jsonb, null) as id",
      [branchId, input.customerId ?? null, input.docType, JSON.stringify(items), JSON.stringify(payments)],
    );
    return rows[0].id;
  });
}
