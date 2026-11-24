import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBs } from "@/lib/money";
import { formatBoPhone } from "@/features/store/phone";
import { buyerHint, isOrderStatus, progressIndex, progressSteps, STATUS_LABEL, type OrderStatus } from "@/features/store/order-state";
import { hashOrderToken, isWellFormedToken } from "@/features/store/order-token";
import { getOrderView, getStoreInfo } from "@/features/store/public-data";
import { LIMITS, requestIp, reserveIp, waitMessage } from "@/features/store/throttle";
import { orderSummaryMessage, paymentProofMessage, waLink } from "@/features/store/whatsapp";
import { AutoRefresh, CancelOrderForm, ClearCartOnNew } from "@/features/store/ui/OrderClient";
import { ProofForm } from "@/features/store/ui/ProofForm";
import { StoreImage, ProductPlaceholder } from "@/features/store/ui/StoreImage";

// The address is a secret link: never indexed, never leaked through the Referer header, never cached.
export const metadata: Metadata = { title: "Estado de su pedido", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ nuevo?: string }> };

export default async function OrderPage({ params, searchParams }: Props) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  if (!isWellFormedToken(token)) notFound();

  const ip = await requestIp();
  const gate = await reserveIp(LIMITS.orderViewIp, ip);
  if (!gate.allowed) {
    return (
      <section className="store-section">
        <p className="notice notice--error" role="alert">{waitMessage(gate)}</p>
      </section>
    );
  }
  const [order, info] = await Promise.all([getOrderView(hashOrderToken(token)), getStoreInfo()]);
  if (!order || !isOrderStatus(order.status)) {
    // Failed lookups get a much smaller budget: this is what a token-guessing script would hit.
    const miss = await reserveIp(LIMITS.orderMissIp, ip);
    if (!miss.allowed) {
      return (
        <section className="store-section">
          <p className="notice notice--error" role="alert">{waitMessage(miss)}</p>
        </section>
      );
    }
    notFound();
  }

  const status: OrderStatus = order.status;
  const shape = { status, paymentMethod: order.payment_method, fulfillment: order.fulfillment };
  const steps = progressSteps(shape);
  const current = progressIndex(status);
  const total = String(order.total);
  const awaitingPayment = order.payment_method === "qr" && (status === "pendiente_pago" || status === "pago_en_revision");
  const moving = status !== "entregado" && status !== "cancelado";
  const summary = waLink(info.whatsapp, orderSummaryMessage({ code: order.code, total, items: order.items.map((i) => ({ model: i.model, color: i.color, size: i.size, qty: i.qty })) }));
  const proofChat = waLink(info.whatsapp, paymentProofMessage({ code: order.code, total }));

  return (
    <section className="store-section order" aria-labelledby="order-title">
      <ClearCartOnNew active={query.nuevo === "1"} />
      {moving ? <AutoRefresh /> : null}

      <header className="order__head">
        <p className="eyebrow">{query.nuevo === "1" ? "¡Pedido recibido!" : "Su pedido"}</p>
        <h1 id="order-title" className="order__code">{order.code}</h1>
        <p className={`sstatus sstatus--${status}`}>{STATUS_LABEL[status]}</p>
        <p className="order__hint">{buyerHint(shape)}</p>
        <p className="order__keep">Guarde este enlace: es la única forma de ver el estado de su pedido.</p>
      </header>

      {status === "cancelado" ? (
        <p className="notice notice--error" role="status">Pedido cancelado{order.cancel_reason ? `: ${order.cancel_reason}` : "."}</p>
      ) : (
        <ol className="steps" aria-label="Progreso del pedido">
          {steps.map((step, index) => (
            <li key={step.status} className={index < current ? "is-done" : index === current ? "is-current" : undefined} aria-current={index === current ? "step" : undefined}>
              <span className="steps__dot" aria-hidden="true">{index < current ? "✓" : index + 1}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}

      {order.reject_reason && status === "pendiente_pago" ? (
        <p className="notice notice--error" role="alert">No pudimos confirmar su comprobante: {order.reject_reason}. Puede enviar otro.</p>
      ) : null}

      {awaitingPayment ? (
        <section className="paybox" aria-labelledby="pay-title">
          <h2 id="pay-title">{status === "pendiente_pago" ? "Pague con QR" : "Pago en revisión"}</h2>
          <div className="paybox__grid">
            {info.has_qr ? (
              <figure className="paybox__qr">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, token-scoped QR served by our route */}
                <img src={`/tienda/qr/${token}`} alt={`QR de pago para el pedido ${order.code}`} width={280} height={280} decoding="async" loading="eager" fetchPriority="high" />
              </figure>
            ) : null}
            <div className="paybox__info">
              <p className="paybox__label">Monto exacto</p>
              <p className="paybox__amount num">{formatBs(total)}</p>
              <p className="paybox__label">Código del pedido (póngalo como glosa si puede)</p>
              <p className="paybox__ref">{order.code}</p>
              {info.bank_instructions ? <p className="paybox__bank">{info.bank_instructions}</p> : null}
              <ol className="paybox__steps">
                <li>Abra la app de su banco y escanee el QR.</li>
                <li>Pague el monto exacto.</li>
                <li>Suba aquí la captura del comprobante.</li>
              </ol>
            </div>
          </div>
          <ProofForm token={token} hasProof={order.proof_count > 0 || Boolean(order.payment_reference)} />
          {proofChat ? (
            <a className="btn btn--small" href={proofChat} target="_blank" rel="noopener noreferrer">
              ¿Prefiere enviarlo por WhatsApp?
            </a>
          ) : null}
        </section>
      ) : null}

      <section className="osum" aria-labelledby="osum-title">
        <h2 id="osum-title">Detalle</h2>
        <ul className="scart__lines scart__lines--compact">
          {order.items.map((item) => (
            <li className="cline" key={`${item.model}-${item.color}-${item.size}`}>
              <div className="cline__media">
                {item.image ? <StoreImage id={item.image} alt="" width={96} height={120} sizes="96px" /> : <ProductPlaceholder name={item.model} />}
              </div>
              <div className="cline__body">
                <p className="cline__name">{item.model}</p>
                <p className="cline__meta">{item.color} · Talla {item.size}</p>
                <div className="cline__foot">
                  <span className="num">{item.qty} × {formatBs(item.unit_price)}</span>
                  <p className="cline__price num">{formatBs(item.qty * item.unit_price)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <dl className="sum">
          <div><dt>Subtotal</dt><dd className="num">{formatBs(order.subtotal)}</dd></div>
          <div><dt>{order.fulfillment === "delivery" ? "Envío" : "Recojo"}</dt><dd className="num">{order.fulfillment === "delivery" ? formatBs(order.delivery_fee) : "Gratis"}</dd></div>
          <div className="sum__total"><dt>Total</dt><dd className="num">{formatBs(order.total)}</dd></div>
        </dl>
        <dl className="facts">
          <div><dt>A nombre de</dt><dd>{order.name} · {formatBoPhone(order.phone)}</dd></div>
          <div>
            <dt>{order.fulfillment === "delivery" ? "Entrega" : "Recojo"}</dt>
            <dd>
              {order.fulfillment === "delivery"
                ? `${order.zone ?? ""} · ${order.address ?? ""}${order.reference ? ` (${order.reference})` : ""}`
                : `${order.pickup?.label ?? order.zone ?? ""}${order.pickup?.address ? ` · ${order.pickup.address}` : ""}${order.pickup?.hours ? ` · ${order.pickup.hours}` : ""}`}
            </dd>
          </div>
          <div><dt>Pago</dt><dd>{order.payment_method === "qr" ? "QR bancario" : "Contra entrega / en tienda"}</dd></div>
          {order.wants_invoice ? <div><dt>Factura</dt><dd>{order.invoice_name} · NIT/CI {order.invoice_nit} (la emitimos manualmente)</dd></div> : null}
        </dl>
      </section>

      <div className="order__actions">
        {summary ? (
          <a className="btn btn--primary" href={summary} target="_blank" rel="noopener noreferrer">
            Enviar por WhatsApp
          </a>
        ) : null}
        <Link className="btn" href="/tienda">Seguir comprando</Link>
        {status === "pendiente_pago" ? <CancelOrderForm token={token} /> : null}
      </div>
    </section>
  );
}
