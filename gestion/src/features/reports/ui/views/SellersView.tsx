import { RankedBars } from "@/components/charts/RankedBars";
import { EmptyState } from "@/components/ui/EmptyState";
import { toSession, type AuthUser } from "@/lib/auth/guards";
import { formatBs } from "@/lib/money";
import { getSalesBySeller, getSalesSummary, listTopDiscounts } from "../../queries";
import type { ReportFilters, ReportScope } from "../../scope";
import { ExportButton } from "../ExportButton";
import { Kpi, KpiRow } from "../Kpi";
import { formatDateTime, saleNumberLabel } from "@/lib/format";
import Link from "next/link";

export async function SellersView({ user, filters, scope }: { user: AuthUser; filters: ReportFilters; scope: ReportScope }) {
  const session = toSession(user);
  const [sellers, summary, discounts] = await Promise.all([
    getSalesBySeller(session, scope),
    getSalesSummary(session, scope),
    listTopDiscounts(session, scope, 10),
  ]);
  if (sellers.length === 0) return <EmptyState title="Sin ventas en este período">Aquí verá cuánto vendió cada persona y los descuentos que otorgó.</EmptyState>;
  const listed = Number(summary.listAmount);
  const pct = listed > 0 ? ((Number(summary.discountTotal) / listed) * 100).toFixed(1).replace(".", ",") : "0";

  return (
    <div className="stack">
      <div className="report-actions"><ExportButton report="ventas" filters={filters} /></div>
      <KpiRow label="Resumen por vendedor">
        <Kpi hero label="Descuentos otorgados" value={formatBs(summary.discountTotal)} note={`${pct} % sobre el precio de lista`} />
        <Kpi label="Productos con descuento" value={String(summary.discountedLines)} note="precio final bajo la lista" />
        <Kpi label="Vendedores activos" value={String(sellers.length)} note="con ventas en el período" />
      </KpiRow>
      <section className="panel" aria-labelledby="sellers-title">
        <div className="panel__head"><h2 id="sellers-title">Ventas por vendedor</h2></div>
        <div className="panel__body stack">
          <RankedBars
            label="Monto vendido por vendedor"
            items={sellers.map((s) => ({ key: s.sellerId, label: s.sellerName, sub: `${s.count} ${s.count === 1 ? "venta" : "ventas"} · ${s.units} pares`, value: Number(s.amount), valueLabel: formatBs(s.amount) }))}
          />
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr><th scope="col">Vendedor</th><th scope="col" className="num">Ventas</th><th scope="col" className="num">Monto</th><th scope="col" className="num">Ticket promedio</th><th scope="col" className="num">Descuentos</th></tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.sellerId}>
                    <th scope="row" data-label="Vendedor">{s.sellerName}</th>
                    <td data-label="Ventas" className="num">{s.count}</td>
                    <td data-label="Monto" className="num"><strong>{formatBs(s.amount)}</strong></td>
                    <td data-label="Ticket promedio" className="num">{formatBs(s.averageTicket)}</td>
                    <td data-label="Descuentos" className="num">{formatBs(s.discountTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="panel" aria-labelledby="disc-top">
        <div className="panel__head"><h2 id="disc-top">Mayores descuentos</h2></div>
        {discounts.length === 0 ? (
          <div className="panel__body"><p className="is-muted">No hubo ventas con descuento.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr><th scope="col">Venta</th><th scope="col">Fecha</th><th scope="col">Vendedor</th><th scope="col" className="num">Lista</th><th scope="col" className="num">Cobrado</th><th scope="col" className="num">Descuento</th></tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.saleId}>
                    <td data-label="Venta"><Link className="row-link" href={`/ventas/${d.saleId}`}>{saleNumberLabel(d.saleNumber)}</Link></td>
                    <td data-label="Fecha" className="num">{formatDateTime(d.createdAt)}</td>
                    <td data-label="Vendedor">{d.sellerName ?? "—"}</td>
                    <td data-label="Lista" className="num">{formatBs(d.listTotal)}</td>
                    <td data-label="Cobrado" className="num">{formatBs(d.total)}</td>
                    <td data-label="Descuento" className="num"><strong>− {formatBs(d.discount)} ({d.percent.replace(".", ",")} %)</strong></td>
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
