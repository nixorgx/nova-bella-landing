import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Kpi, KpiRow } from "@/features/reports/ui/Kpi";
import { formatDateTime, formatTime, saleNumberLabel } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { PAYMENT_LABEL } from "@/features/sales/payments";
import { MethodChips, StatusBadge } from "@/features/sales/ui/SaleBadges";
import type { CashSessionReport, SessionExchangeRow, SessionSaleRow } from "../session-report";
import { DifferenceBadge } from "./CashSessionTable";

interface Props {
  readonly cash: CashSessionReport;
  readonly sales: readonly SessionSaleRow[];
  readonly exchanges: readonly SessionExchangeRow[];
  readonly isAdmin: boolean;
}

export function CashSessionDetailView({ cash, sales, exchanges }: Props) {
  const cashRow = cash.methods.find((m) => m.method === "efectivo");
  return (
    <div className="stack">
      <KpiRow label="Resumen de la caja">
        <Kpi hero label="Total vendido" value={formatBs(cash.salesTotal)} note={`${cash.salesCount} ventas${cash.voidCount ? ` · ${cash.voidCount} anuladas (no suman)` : ""}`} />
        <Kpi label="Efectivo esperado" value={formatBs(cash.expectedCash)} note="inicial + efectivo ± cambios" />
        <Kpi label="Efectivo contado" value={cash.closingAmount === null ? "—" : formatBs(cash.closingAmount)} note={cash.closedAt ? `cerrada ${formatDateTime(cash.closedAt)}` : "la caja sigue abierta"} />
        <Kpi label="Resultado" value={cash.difference === null ? "En curso" : cash.difference === "0.00" ? "Cuadra" : formatBs(cash.difference)} note={cash.difference === null ? "se calcula al cerrar" : cash.difference.startsWith("-") ? "falta dinero" : cash.difference === "0.00" ? "sin diferencia" : "sobra dinero"}>
          {cash.closedAt ? <DifferenceBadge difference={cash.difference} status={cash.status} /> : null}
        </Kpi>
      </KpiRow>

      <div className="two-up">
        <section className="panel" aria-labelledby="cash-methods">
          <div className="panel__head"><h2 id="cash-methods">Por método de pago</h2></div>
          <div className="panel__body stack">
            <dl className="method-grid">
              {cash.methods.map((m) => (
                <div key={m.method}>
                  <dt>{PAYMENT_LABEL[m.method]}</dt>
                  <dd>{formatBs(m.net)}</dd>
                  <small>{m.exchanges === "0.00" ? "ventas" : `ventas ${formatBs(m.sales)} · cambios ${formatBs(m.exchanges)}`}</small>
                </div>
              ))}
            </dl>
            <dl className="money-list">
              <div><dt>Efectivo inicial</dt><dd>{formatBs(cash.openingAmount)}</dd></div>
              <div><dt>+ Ventas en efectivo</dt><dd>{formatBs(cashRow?.sales ?? "0")}</dd></div>
              <div><dt>± Cambios en efectivo (cobrado − devuelto)</dt><dd>{formatBs(cashRow?.exchanges ?? "0")}</dd></div>
              <div className="is-total"><dt>= Efectivo esperado</dt><dd>{formatBs(cash.expectedCash)}</dd></div>
            </dl>
          </div>
        </section>
        <section className="panel" aria-labelledby="cash-info">
          <div className="panel__head"><h2 id="cash-info">Datos de la caja</h2></div>
          <div className="panel__body">
            <dl className="detail-meta">
              <div><dt>Sucursal</dt><dd>{cash.branchName}</dd></div>
              <div><dt>Cajero</dt><dd>{cash.openedByName ?? "—"}</dd></div>
              <div><dt>Apertura</dt><dd>{formatDateTime(cash.openedAt)}</dd></div>
              <div><dt>Cierre</dt><dd>{cash.closedAt ? formatDateTime(cash.closedAt) : "Abierta"}</dd></div>
              <div><dt>Cambios registrados</dt><dd>{cash.exchangeCount}</dd></div>
              <div><dt>Ventas anuladas</dt><dd>{cash.voidCount}{cash.voidCount ? ` · ${formatBs(cash.voidTotal)}` : ""}</dd></div>
            </dl>
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="cash-sales">
        <div className="panel__head"><h2 id="cash-sales">Ventas de esta caja</h2><span className="eyebrow">{sales.length}</span></div>
        {sales.length === 0 ? (
          <div className="panel__body"><EmptyState title="Esta caja no registró ventas">Las ventas del turno aparecen aquí.</EmptyState></div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr><th scope="col">N°</th><th scope="col">Hora</th><th scope="col">Cliente</th><th scope="col">Vendedor</th><th scope="col">Pagos</th><th scope="col" className="num">Total</th></tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} className={sale.status === "voided" ? "is-muted" : undefined}>
                    <td data-label="N°"><Link className="row-link" href={`/ventas/${sale.id}`}>{saleNumberLabel(sale.saleNumber)}</Link> <StatusBadge status={sale.status} /></td>
                    <td data-label="Hora" className="num">{formatTime(sale.createdAt)}</td>
                    <td data-label="Cliente"><span className="clip-2">{sale.customerName ?? "Sin cliente"}</span></td>
                    <td data-label="Vendedor"><span className="clip-2">{sale.sellerName ?? "—"}</span></td>
                    <td data-label="Pagos"><MethodChips methods={sale.methods} /></td>
                    <td data-label="Total" className="num">
                      {sale.status === "voided" ? <s>{formatBs(sale.total)}</s> : <strong>{formatBs(sale.total)}</strong>}
                      {sale.voidReason ? <span className="is-muted block">{sale.voidReason}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {exchanges.length > 0 ? (
        <section className="panel" aria-labelledby="cash-exchanges">
          <div className="panel__head"><h2 id="cash-exchanges">Cambios con diferencia de dinero</h2><span className="eyebrow">{exchanges.length}</span></div>
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr><th scope="col">Hora</th><th scope="col">Venta</th><th scope="col">Cambio</th><th scope="col">Método</th><th scope="col" className="num">Diferencia</th></tr>
              </thead>
              <tbody>
                {exchanges.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Hora" className="num">{formatTime(e.createdAt)}</td>
                    <td data-label="Venta"><Link className="row-link" href={`/ventas/${e.saleId}`}>{saleNumberLabel(e.saleNumber)}</Link></td>
                    <td data-label="Cambio"><span className="clip-2">{e.summary}</span></td>
                    <td data-label="Método">{e.method ? PAYMENT_LABEL[e.method] : "Sin diferencia"}</td>
                    <td data-label="Diferencia" className="num"><strong>{e.priceDiff.startsWith("-") ? `Devuelto ${formatBs(e.priceDiff.replace("-", ""))}` : formatBs(e.priceDiff)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
