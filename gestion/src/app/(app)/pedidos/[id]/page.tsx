import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { getOrder } from "@/features/orders/queries";
import { OrderActions } from "@/features/orders/ui/OrderActions";
import { OrderStatusBadge } from "@/features/orders/ui/OrderBadges";
import { formatBoPhone } from "@/features/store/phone";
import { STATUS_LABEL, isOrderStatus } from "@/features/store/order-state";

export const metadata: Metadata = { title: "Pedido web" };

const METHOD = { efectivo: "Efectivo", qr: "QR", transferencia: "Transferencia", tarjeta: "Tarjeta" } as const;

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("superadmin", "seller");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const order = await getOrder(toSession(user), id);
  if (!order) notFound();
  const isAdmin = user.role === "superadmin";
  const shape = { status: order.status, paymentMethod: order.paymentMethod, fulfillment: order.fulfillment };

  return (
    <div className="page page--wide">
      <PageHead eyebrow={`Pedido web · ${formatDateTime(order.createdAt)}`} title={order.code}>
        <div className="head-actions">
          <OrderStatusBadge status={order.status} />
          <Link className="btn btn--quiet" href="/pedidos">← Pedidos</Link>
          {order.saleId ? <Link className="btn" href={`/ventas/${order.saleId}`}>Ver la venta</Link> : null}
        </div>
      </PageHead>

      <div className="order-admin">
        <div className="order-admin__main">
          <section className="panel" aria-labelledby="items-title">
            <div className="panel__head"><h2 id="items-title">Productos</h2></div>
            <div className="table-wrap">
              <table className="table table--stack">
                <thead><tr><th scope="col">Producto</th><th scope="col">Color · Talla</th><th scope="col" className="num">Cant.</th><th scope="col" className="num">Precio</th><th scope="col" className="num">Subtotal</th></tr></thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={`${item.sku}`}>
                      <td data-label="Producto">{item.model}<br /><span className="is-muted">{item.sku}</span></td>
                      <td data-label="Color · Talla">{item.color} · {item.size}</td>
                      <td data-label="Cant." className="num">{item.qty}</td>
                      <td data-label="Precio" className="num">{formatBs(item.unitPrice)}</td>
                      <td data-label="Subtotal" className="num">{formatBs(Number(item.unitPrice) * item.qty)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><th scope="row" colSpan={4}>Subtotal</th><td className="num">{formatBs(order.subtotal)}</td></tr>
                  <tr><th scope="row" colSpan={4}>{order.fulfillment === "delivery" ? `Envío (${order.zone ?? ""})` : "Recojo"}</th><td className="num">{formatBs(order.deliveryFee)}</td></tr>
                  <tr><th scope="row" colSpan={4}>Total que paga el cliente</th><td className="num"><strong>{formatBs(order.total)}</strong></td></tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="panel" aria-labelledby="hist-title">
            <div className="panel__head"><h2 id="hist-title">Historial</h2></div>
            <ol className="timeline">
              {order.events.map((e, index) => (
                <li key={`${e.at}-${index}`}>
                  <span className="num">{formatDateTime(e.at)}</span>
                  <strong>{isOrderStatus(e.to) ? STATUS_LABEL[e.to] : e.to}</strong>
                  <span className="is-muted"> · {e.kind === "buyer" ? "Cliente" : e.actor ?? (e.kind === "seller" ? "Vendedor" : "Equipo")}{e.note ? ` · ${e.note}` : ""}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="order-admin__side">
          <section className="panel" aria-labelledby="act-title">
            <div className="panel__head"><h2 id="act-title">Acciones</h2></div>
            <div className="panel__body">
              {order.rejectReason && order.status === "pendiente_pago" ? <p className="notice">Último rechazo: {order.rejectReason}</p> : null}
              {order.cancelReason ? <p className="notice notice--error">Cancelado: {order.cancelReason}</p> : null}
              <OrderActions orderId={order.id} order={shape} role={user.role} />
            </div>
          </section>

          <section className="panel" aria-labelledby="cust-title">
            <div className="panel__head"><h2 id="cust-title">Cliente y entrega</h2></div>
            <dl className="panel__body facts">
              <div><dt>Cliente</dt><dd>{order.customerName}</dd></div>
              <div><dt>Celular</dt><dd><a href={`https://wa.me/591${order.phone}`} target="_blank" rel="noopener noreferrer">{formatBoPhone(order.phone)} (WhatsApp)</a></dd></div>
              {order.email ? <div><dt>Correo</dt><dd>{order.email}</dd></div> : null}
              <div><dt>{order.fulfillment === "delivery" ? "Entrega" : "Recojo"}</dt><dd>{order.fulfillment === "delivery" ? `${order.zone ?? ""} · ${order.address ?? ""}${order.reference ? ` (${order.reference})` : ""}` : order.pickupLabel ?? "En tienda"}</dd></div>
              {order.notes ? <div><dt>Nota del cliente</dt><dd>{order.notes}</dd></div> : null}
              {order.wantsInvoice ? <div><dt>Factura</dt><dd>{order.invoiceName} · NIT/CI {order.invoiceNit}<br /><span className="is-muted">{order.invoiceStatus === "pending_manual" ? "Pendiente de emitir (manual)" : order.invoiceStatus}</span></dd></div> : null}
            </dl>
          </section>

          <section className="panel" aria-labelledby="pay-title">
            <div className="panel__head"><h2 id="pay-title">Pago</h2></div>
            <div className="panel__body">
              <dl className="facts">
                <div><dt>Método</dt><dd>{order.paymentMethod === "qr" ? "QR bancario" : "Contra entrega / en tienda"}</dd></div>
                {order.collectedMethod ? <div><dt>Cobrado como</dt><dd>{METHOD[order.collectedMethod as keyof typeof METHOD] ?? order.collectedMethod}</dd></div> : null}
                {isAdmin ? (
                  <>
                    <div><dt>N.º de transacción</dt><dd>{order.paymentReference ?? "—"}</dd></div>
                    <div><dt>Comprobantes</dt><dd>{order.proofs.length === 0 ? "Ninguno" : order.proofs.length}</dd></div>
                  </>
                ) : null}
              </dl>
              {isAdmin && order.proofs.length > 0 ? (
                <ul className="proofs">
                  {order.proofs.map((proof, index) => (
                    <li key={proof.id}>
                      <a href={`/pedidos/${order.id}/comprobante/${proof.id}`} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private proof served by an authenticated route */}
                        <img src={`/pedidos/${order.id}/comprobante/${proof.id}`} alt={`Comprobante ${index + 1}, ${formatDateTime(proof.createdAt)}`} width={160} height={200} loading="lazy" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
