import Link from "next/link";
import { DailyChart } from "@/components/charts/DailyChart";
import { EmptyState } from "@/components/ui/EmptyState";
import { toSession, type AuthUser } from "@/lib/auth/guards";
import { formatDateTime, saleNumberLabel } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { previousRange } from "../../period";
import { getProfitSummary } from "../../cost-queries";
import { getDailySales, getSalesSummary, listTopDiscounts } from "../../queries";
import { filterQuery, type ReportFilters, type ReportScope } from "../../scope";
import { ExportButton } from "../ExportButton";
import { Delta, Kpi, KpiRow } from "../Kpi";
import { MethodBreakdown } from "../MethodBreakdown";

interface Props {
  readonly user: AuthUser;
  readonly filters: ReportFilters;
  readonly scope: ReportScope;
}

export async function SummaryView({ user, filters, scope }: Props) {
  const session = toSession(user);
  const isAdmin = user.role === "superadmin";
  const before = previousRange(scope);
  const priorScope = { ...scope, ...before };
  const [summary, daily, priorSummary, priorDaily, discounts, profit] = await Promise.all([
    getSalesSummary(session, scope),
    getDailySales(session, scope),
    getSalesSummary(session, priorScope),
    getDailySales(session, priorScope),
    listTopDiscounts(session, scope, 5),
    isAdmin ? getProfitSummary(session, scope) : Promise.resolve(null),
  ]);

  if (summary.count === 0 && summary.exchangeCount === 0 && summary.voidCount === 0) {
    return (
      <EmptyState title="Sin ventas en este período" action={<Link className="btn btn--small" href="/reportes?periodo=mes">Ver el mes</Link>}>
        Pruebe con otro período o con un rango personalizado. Las ventas confirmadas aparecen aquí al instante.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="report-actions">
        <ExportButton report="ventas" filters={filters} />
      </div>
      <KpiRow label="Resumen de ventas">
        <Kpi hero label={isAdmin ? "Ventas del período" : "Mis ventas del período"} value={formatBs(summary.amount)} note={`${summary.count} ${summary.count === 1 ? "venta" : "ventas"} · sin anuladas`}>
          <Delta current={summary.amount} previous={priorSummary.amount} label="vs período anterior" />
        </Kpi>
        <Kpi label="Ticket promedio" value={formatBs(summary.averageTicket)} note="por venta" />
        <Kpi label="Pares vendidos" value={String(summary.units)} note={`${summary.discountedLines} con descuento`} />
        {profit ? (
          <Kpi cost label="Utilidad" value={formatBs(profit.profit)} note={profit.marginPct ? `margen ${profit.marginPct.replace(".", ",")} % · solo superadmin` : "solo superadmin"} />
        ) : null}
      </KpiRow>

      <section className="panel" aria-label="Ventas por día">
        <div className="panel__body">
          <DailyChart
            title="Ventas por día"
            seriesLabel={filters.period.label}
            points={daily}
            compare={{ label: "Período anterior", points: priorDaily }}
          />
        </div>
      </section>

      <MethodBreakdown methods={summary.methods} />

      <div className="two-up">
        <section className="panel" aria-labelledby="disc-title">
          <div className="panel__head"><h2 id="disc-title">Descuentos otorgados</h2></div>
          <div className="panel__body stack">
            <p className="figure-line">
              <strong className="num">{formatBs(summary.discountTotal)}</strong>
              <span>en {summary.discountedLines} {summary.discountedLines === 1 ? "producto" : "productos"} con precio bajo la lista</span>
            </p>
            {discounts.length === 0 ? (
              <p className="is-muted">Ninguna venta de este período tuvo descuento.</p>
            ) : (
              <ul className="plain-list">
                {discounts.map((d) => (
                  <li key={d.saleId}>
                    <Link className="row-link" href={`/ventas/${d.saleId}`}>N° {saleNumberLabel(d.saleNumber)}</Link>
                    <span className="is-muted">{formatDateTime(d.createdAt)}{d.sellerName ? ` · ${d.sellerName}` : ""}</span>
                    <span className="num">− {formatBs(d.discount)} ({d.percent.replace(".", ",")} %)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="ex-title">
          <div className="panel__head"><h2 id="ex-title">Cambios y anulaciones</h2></div>
          <div className="panel__body stack">
            <dl className="money-list">
              <div><dt>Cambios de talla o modelo</dt><dd>{summary.exchangeCount}</dd></div>
              <div><dt>Diferencia neta de cambios</dt><dd>{formatBs(summary.exchangeNet)}</dd></div>
              <div><dt>Ventas anuladas (no suman)</dt><dd>{summary.voidCount} · {formatBs(summary.voidAmount)}</dd></div>
            </dl>
            <Link className="btn btn--small" href={`/reportes?${filterQuery(filters, { vista: "cambios" })}`}>Ver el detalle</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
