import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime, saleNumberLabel } from "@/lib/format";
import { dec, formatBs } from "@/lib/money";
import { uuidParam } from "@/lib/search-params";
import { PAYMENT_LABEL } from "@/features/sales/payments";
import { getOpenSession } from "@/features/cash/queries";
import { getReturnableLines } from "@/features/exchanges/queries";
import { ExchangeHistory } from "@/features/exchanges/ui/ExchangeHistory";
import { ExchangePanel } from "@/features/exchanges/ui/ExchangePanel";
import { getSaleDetail } from "@/features/sales/queries";
import { VoidSalePanel } from "@/features/sales/ui/VoidSalePanel";
import { DocBadge, StatusBadge } from "@/features/sales/ui/SaleBadges";

export const metadata: Metadata = { title: "Detalle de venta" };

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("superadmin", "seller");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const sale = await getSaleDetail(toSession(user), id);
  if (!sale) notFound();
  const session = toSession(user);
  const isAdmin = user.role === "superadmin";
  const completed = sale.status === "completed";
  const [returnable, cash] = completed
    ? await Promise.all([getReturnableLines(session, sale.id), getOpenSession(session, sale.branchId)])
    : [[], null];

  return (
    <div className="page">
      <PageHead eyebrow={`${sale.branchName} · ${formatDateTime(sale.createdAt)}`} title={`Venta N° ${saleNumberLabel(sale.saleNumber)}`}>
        <div className="head-actions">
          <Link href="/ventas/historial" className="btn btn--quiet">Volver al historial</Link>
          {/* Plain anchor: the ticket needs a fresh document for its @page size to apply. */}
          <a href={`/ventas/${sale.id}/ticket`} className="btn btn--primary">Ver ticket / Reimprimir</a>
        </div>
      </PageHead>

      {sale.status === "voided" && sale.voidInfo ? (
        <section className="void-banner" aria-labelledby="void-title">
          <h2 id="void-title">Venta anulada</h2>
          <p>
            {formatDateTime(sale.voidInfo.voidedAt)} · {sale.voidInfo.voidedByName ?? "Administración"}
          </p>
          <p><strong>Motivo:</strong> {sale.voidInfo.reason ?? "Sin motivo registrado"}</p>
          <p className="is-muted">Los pares volvieron al stock y el monto de {formatBs(sale.total)} no suma en cajas ni reportes.</p>
        </section>
      ) : null}

      <div className="detail-grid">
        <div className="stack detail-main">
        <section className="panel" aria-labelledby="lines-title">
          <div className="panel__head">
            <h2 id="lines-title">Productos</h2>
            <span className="head-actions"><DocBadge type={sale.docType} channel={sale.channel} /><StatusBadge status={sale.status} /></span>
          </div>
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" className="num">Cant.</th>
                  <th scope="col" className="num">Precio lista</th>
                  <th scope="col" className="num">Precio final</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((line) => (
                  <tr key={line.sku}>
                    <td data-label="Producto"><strong>{line.model}</strong><span className="is-muted">{line.color} · Talla {line.size}</span> <code className="sku">{line.sku}</code></td>
                    <td data-label="Cantidad" className="num">{line.qty}</td>
                    <td data-label="Precio lista" className="num">{formatBs(line.listPrice)}</td>
                    <td data-label="Precio final" className="num"><strong>{formatBs(line.finalPrice)}</strong></td>
                    <td data-label="Total" className="num">{formatBs(dec(line.finalPrice).times(line.qty).toFixed(2))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

          {completed ? (
            <ExchangePanel saleId={sale.id} branchId={sale.branchId} lines={returnable} isAdmin={isAdmin} cashOpen={Boolean(cash)} />
          ) : null}
          <ExchangeHistory saleId={sale.id} groups={sale.exchanges} />
          {isAdmin && completed ? <VoidSalePanel saleId={sale.id} exchangeCount={sale.exchanges.reduce((n, g) => n + g.lines.length, 0)} /> : null}
        </div>

        <aside className="stack" aria-label="Resumen de la venta">
          <section className="panel">
            <div className="panel__body stack">
              <dl className="detail-meta">
                <div><dt>Vendedor</dt><dd>{sale.sellerName ?? "—"}</dd></div>
                <div><dt>Cliente</dt><dd>{sale.customer ? <Link className="row-link" href={`/clientes/${sale.customer.id}`}>{sale.customer.name}</Link> : "Sin cliente"}</dd></div>
              </dl>
              <dl className="money-list">
                <div><dt>Subtotal (lista)</dt><dd>{formatBs(sale.listTotal)}</dd></div>
                <div><dt>Descuento</dt><dd>{sale.discount === "0.00" ? "—" : `− ${formatBs(sale.discount)}`}</dd></div>
                <div className="is-total"><dt>Total</dt><dd>{formatBs(sale.total)}</dd></div>
              </dl>
            </div>
          </section>
          <section className="panel" aria-labelledby="pay-title">
            <div className="panel__head"><h2 id="pay-title">Pagos</h2></div>
            <div className="panel__body">
              <dl className="money-list">
                {sale.payments.map((payment, index) => (
                  <div key={`${payment.method}-${index}`}><dt>{PAYMENT_LABEL[payment.method]}</dt><dd>{formatBs(payment.amount)}</dd></div>
                ))}
              </dl>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
