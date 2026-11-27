import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { buildPage, type Page, type PageRequest } from "@/lib/pagination";
import {
  isOrderStatus,
  NEEDS_DISPATCH,
  NEEDS_PAYMENT_ACTION,
  ORDER_STATUSES,
  type Fulfillment,
  type OrderStatus,
  type PaymentMethodWeb,
} from "@/features/store/order-state";

/*
 * Staff-side order reads. They run as the signed-in user's database role: the superadmin sees every order and
 * proof; a seller only sees the orders of their own branch (RLS) and has no access to proofs at all. Nothing here
 * touches a cost table.
 */
export interface OrderRow {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly paymentMethod: PaymentMethodWeb;
  readonly fulfillment: Fulfillment;
  readonly customerName: string;
  readonly phone: string;
  readonly total: string;
  readonly proofCount: number;
  readonly createdAt: string;
  readonly saleId: string | null;
}

export interface OrderFilters {
  readonly status?: OrderStatus;
  readonly q?: string;
}

export async function countByStatus(session: SessionPayload): Promise<Record<OrderStatus, number>> {
  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  const { rows } = await withUser(session, (c) =>
    c.query<{ status: string; n: number }>("select status, count(*)::int as n from web_orders group by status"),
  );
  for (const row of rows) if (isOrderStatus(row.status)) counts[row.status] = row.n;
  return counts;
}

/** Orders waiting for the team: payment to review for the superadmin, dispatch for sellers. */
export async function countOpenOrders(session: SessionPayload): Promise<number> {
  const statuses = session.role === "superadmin" ? NEEDS_PAYMENT_ACTION : NEEDS_DISPATCH.filter((s) => s === "confirmado");
  const { rows } = await withUser(session, (c) =>
    c.query<{ n: number }>("select count(*)::int as n from web_orders where status = any($1::text[])", [statuses]),
  );
  return rows[0]?.n ?? 0;
}

interface ListRow {
  id: string; code: string; status: string; payment_method: PaymentMethodWeb; fulfillment: Fulfillment;
  customer_name: string; phone: string; total: string; proof_count: number; created_at: string; sale_id: string | null;
}

export async function listOrders(session: SessionPayload, filters: OrderFilters, request: PageRequest): Promise<Page<OrderRow>> {
  const search = filters.q ? `%${filters.q.replace(/[%_\\]/g, "\\$&")}%` : null;
  const values = [filters.status ?? null, search];
  const where = "($1::text is null or o.status = $1) and ($2::text is null or o.code ilike $2 or o.customer_name ilike $2 or o.phone like $2)";
  return withUser(session, async (client) => {
    const total = await client.query<{ n: number }>(`select count(*)::int as n from web_orders o where ${where}`, values);
    const { rows } = await client.query<ListRow>(
      `select o.id, o.code, o.status, o.payment_method, o.fulfillment, o.customer_name, o.phone, o.total::text,
              o.proof_count, o.created_at::text, o.sale_id
         from web_orders o where ${where}
        order by (o.status in ('pendiente_pago','pago_en_revision')) desc, o.created_at desc
        limit $3 offset $4`,
      [...values, request.pageSize, (request.page - 1) * request.pageSize],
    );
    const mapped = rows.filter((r) => isOrderStatus(r.status)).map<OrderRow>((r) => ({
      id: r.id, code: r.code, status: r.status as OrderStatus, paymentMethod: r.payment_method, fulfillment: r.fulfillment,
      customerName: r.customer_name, phone: r.phone, total: r.total, proofCount: r.proof_count, createdAt: r.created_at, saleId: r.sale_id,
    }));
    return buildPage(mapped, total.rows[0].n, request);
  });
}

export interface OrderDetail extends OrderRow {
  readonly email: string | null;
  readonly wantsInvoice: boolean;
  readonly invoiceNit: string | null;
  readonly invoiceName: string | null;
  readonly invoiceStatus: string;
  readonly zone: string | null;
  readonly address: string | null;
  readonly reference: string | null;
  readonly pickupLabel: string | null;
  readonly subtotal: string;
  readonly deliveryFee: string;
  readonly notes: string | null;
  readonly paymentReference: string | null;
  readonly rejectReason: string | null;
  readonly cancelReason: string | null;
  readonly collectedMethod: string | null;
  readonly items: readonly { sku: string; model: string; color: string; size: string; qty: number; unitPrice: string }[];
  readonly events: readonly { at: string; kind: string; from: string | null; to: string; note: string | null; actor: string | null }[];
  readonly proofs: readonly { id: string; createdAt: string }[];
}

export async function getOrder(session: SessionPayload, id: string): Promise<OrderDetail | null> {
  return withUser(session, async (client) => {
    const head = await client.query(
      `select o.*, o.total::text as total_t, o.subtotal::text as subtotal_t, o.delivery_fee::text as fee_t, o.created_at::text as created_t
         from web_orders o where o.id = $1`,
      [id],
    );
    const o = head.rows[0];
    if (!o || !isOrderStatus(o.status)) return null;
    const items = await client.query(
      "select sku, model_name, color_name, size_label, qty, unit_price::text as price from web_order_items where order_id = $1 order by model_name, color_name, size_label",
      [id],
    );
    const events = await client.query(
      `select e.at::text, e.actor_kind, e.from_status, e.to_status, e.note, u.full_name
         from web_order_events e left join users u on u.id = e.actor_id where e.order_id = $1 order by e.at, e.id`,
      [id],
    );
    // Sellers have no grant on proofs: the query would fail, so only the superadmin runs it.
    const proofs = session.role === "superadmin"
      ? await client.query("select id, created_at::text from web_order_proofs where order_id = $1 order by created_at", [id])
      : { rows: [] as { id: string; created_at: string }[] };
    return {
      id: o.id, code: o.code, status: o.status as OrderStatus, paymentMethod: o.payment_method, fulfillment: o.fulfillment,
      customerName: o.customer_name, phone: o.phone, total: o.total_t, proofCount: o.proof_count, createdAt: o.created_t, saleId: o.sale_id,
      email: o.email, wantsInvoice: o.wants_invoice, invoiceNit: o.invoice_nit, invoiceName: o.invoice_name, invoiceStatus: o.invoice_status,
      zone: o.delivery_zone, address: o.delivery_address, reference: o.delivery_reference, pickupLabel: o.fulfillment === "pickup" ? o.delivery_zone : null,
      subtotal: o.subtotal_t, deliveryFee: o.fee_t, notes: o.notes, paymentReference: o.payment_reference,
      rejectReason: o.reject_reason, cancelReason: o.cancel_reason, collectedMethod: o.collected_method,
      items: items.rows.map((r) => ({ sku: r.sku, model: r.model_name, color: r.color_name, size: r.size_label, qty: r.qty, unitPrice: r.price })),
      events: events.rows.map((r) => ({ at: r.at, kind: r.actor_kind, from: r.from_status, to: r.to_status, note: r.note, actor: r.full_name })),
      proofs: proofs.rows.map((r) => ({ id: r.id, createdAt: r.created_at })),
    };
  });
}

/** One proof image (superadmin only; the database refuses sellers). */
export async function getProof(session: SessionPayload, orderId: string, proofId: string): Promise<{ bytes: Buffer; etag: string } | null> {
  const { rows } = await withUser(session, (c) =>
    c.query<{ bytes: Buffer; etag: string }>("select bytes, etag from web_order_proofs where id = $1 and order_id = $2", [proofId, orderId]),
  );
  return rows[0] ?? null;
}
