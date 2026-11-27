import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { toSession, type AuthUser } from "@/lib/auth/guards";
import { formatDateTime, saleNumberLabel } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { PAYMENT_LABEL } from "@/features/sales/payments";
import { listExchangesInPeriod, listVoidsInPeriod } from "../../queries";
import type { ReportFilters, ReportScope } from "../../scope";
import { ExportButton } from "../ExportButton";

export async function ExchangesView({ user, filters, scope }: { user: AuthUser; filters: ReportFilters; scope: ReportScope }) {
  const session = toSession(user);
  const [exchanges, voids] = await Promise.all([listExchangesInPeriod(session, scope, 200), listVoidsInPeriod(session, scope, 200)]);
  if (exchanges.length === 0 && voids.length === 0) {
    return <EmptyState title="Sin cambios ni anulaciones">En este período no hubo cambios de talla o modelo ni ventas anuladas.</EmptyState>;
  }
  return (
    <div className="stack">
      <div className="report-actions"><ExportButton report="ventas" filters={filters} label="Descargar Excel (hojas Cambios y Anulaciones)" /></div>
      <section className="panel" aria-labelledby="ex-list">
        <div className="panel__head"><h2 id="ex-list">Cambios de talla o modelo</h2><span className="eyebrow">{exchanges.length}</span></div>
        {exchanges.length === 0 ? (
          <div className="panel__body"><p className="is-muted">No hubo cambios en este período.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Fecha</th><th scope="col">Venta</th><th scope="col">Devuelto</th><th scope="col">Entregado</th>
                  <th scope="col" className="num">Diferencia</th><th scope="col">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {exchanges.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Fecha" className="num">{formatDateTime(e.createdAt)}</td>
                    <td data-label="Venta"><Link className="row-link" href={`/ventas/${e.saleId}`}>{saleNumberLabel(e.saleNumber)}</Link></td>
                    <td data-label="Devuelto"><span className="clip-2">{e.qty} × {e.returned}</span></td>
                    <td data-label="Entregado"><span className="clip-2">{e.replacement}</span></td>
                    <td data-label="Diferencia" className="num">
                      {e.priceDiff === "0.00" ? "Sin diferencia" : <strong>{formatBs(e.priceDiff)}{e.method ? ` · ${PAYMENT_LABEL[e.method]}` : ""}</strong>}
                    </td>
                    <td data-label="Motivo"><span className="clip-2">{e.reason ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel" aria-labelledby="void-list">
        <div className="panel__head"><h2 id="void-list">Ventas anuladas</h2><span className="eyebrow">{voids.length} · no suman en los totales</span></div>
        {voids.length === 0 ? (
          <div className="panel__body"><p className="is-muted">No hubo anulaciones en este período.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr><th scope="col">Venta</th><th scope="col">Anulada</th><th scope="col" className="num">Total</th><th scope="col">Motivo</th><th scope="col">Vendedor</th><th scope="col">Anulada por</th></tr>
              </thead>
              <tbody>
                {voids.map((v) => (
                  <tr key={v.saleId}>
                    <td data-label="Venta"><Link className="row-link" href={`/ventas/${v.saleId}`}>{saleNumberLabel(v.saleNumber)}</Link> <span className="badge badge--void">Anulada</span></td>
                    <td data-label="Anulada" className="num">{formatDateTime(v.voidedAt)}</td>
                    <td data-label="Total" className="num">{formatBs(v.total)}</td>
                    <td data-label="Motivo"><span className="clip-2">{v.reason ?? "—"}</span></td>
                    <td data-label="Vendedor">{v.sellerName ?? "—"}</td>
                    <td data-label="Anulada por">{v.voidedByName ?? "Administración"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
