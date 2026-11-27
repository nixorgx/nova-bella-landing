import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Pagination } from "@/components/ui/Pagination";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatBs, sumMoney } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { dateParam, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions } from "@/features/branches/queries";
import { listCashiers, listCashSessions, type CashSessionFilters } from "@/features/cash/session-report";
import { CashSessionTable } from "@/features/cash/ui/CashSessionTable";
import { resolvePeriod } from "@/features/reports/period";
import { ExportButton } from "@/features/reports/ui/ExportButton";
import { Kpi, KpiRow } from "@/features/reports/ui/Kpi";

export const metadata: Metadata = { title: "Cajas" };

export default async function CashSessionsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const params = await searchParams;
  const filters: CashSessionFilters = {
    from: dateParam(params.desde),
    to: dateParam(params.hasta),
    branchId: uuidParam(params.sucursal),
    openedBy: uuidParam(params.cajero),
  };
  const [sessions, branches, cashiers] = await Promise.all([
    listCashSessions(session, filters, parsePageRequest(params)),
    listBranchOptions(session, { includeInactive: true }),
    listCashiers(session),
  ]);
  const filtered = Boolean(filters.from || filters.to || filters.branchId || filters.openedBy);
  const rows = sessions.rows;
  const closed = rows.filter((cash) => cash.difference !== null);
  const exportFilters = {
    period: resolvePeriod({ periodo: "rango", desde: filters.from ?? "2000-01-01", hasta: filters.to }),
    branchId: filters.branchId ?? null,
    sellerId: null,
    channel: null,
  };

  return (
    <div className="page page--wide">
      <PageHead eyebrow="Todas las sucursales" title="Cajas" description="Cada turno con su efectivo esperado, lo contado y el desglose por método de pago.">
        <ExportButton report="caja" filters={exportFilters} extra={{ cajero: filters.openedBy }} label="Descargar Excel" />
      </PageHead>

      <KpiRow label="Resumen de esta página">
        <Kpi hero label="Vendido en estas cajas" value={formatBs(sumMoney(rows.map((c) => c.salesTotal)))} note={`${rows.reduce((n, c) => n + c.salesCount, 0)} ventas sin anuladas`} />
        <Kpi label="Cajas" value={String(sessions.total)} note={`${rows.filter((c) => c.status === "open").length} abiertas en esta página`} />
        <Kpi label="Diferencia acumulada" value={formatBs(sumMoney(closed.map((c) => c.difference ?? "0")))} note={`${closed.filter((c) => c.difference !== "0.00").length} cajas con diferencia`} />
        <Kpi label="Anulaciones" value={String(rows.reduce((n, c) => n + c.voidCount, 0))} note="ventas anuladas en estas cajas" />
      </KpiRow>

      <section className="panel" aria-labelledby="cajas-title">
        <div className="panel__head"><h2 id="cajas-title">Turnos de caja</h2><span className="eyebrow">{sessions.total} {sessions.total === 1 ? "resultado" : "resultados"}</span></div>
        <div className="panel__body">
          <form method="get" action="/cajas" className="filters filters--cash" role="search" aria-label="Filtrar cajas">
            <div className="field">
              <label className="field__label" htmlFor="c-desde">Desde</label>
              <input id="c-desde" name="desde" type="date" className="field__control" defaultValue={filters.from ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="c-hasta">Hasta</label>
              <input id="c-hasta" name="hasta" type="date" className="field__control" defaultValue={filters.to ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="c-sucursal">Sucursal</label>
              <select id="c-sucursal" name="sucursal" className="field__control" defaultValue={filters.branchId ?? ""}>
                <option value="">Todas</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="c-cajero">Cajero</label>
              <select id="c-cajero" name="cajero" className="field__control" defaultValue={filters.openedBy ?? ""}>
                <option value="">Todos</option>
                {cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="filters__buttons">
              <button type="submit" className="btn">Filtrar</button>
              <Link href="/cajas" className="btn btn--quiet">Limpiar</Link>
            </div>
          </form>
        </div>
        {rows.length === 0 ? (
          <div className="panel__body">
            <EmptyState title={filtered ? "Ninguna caja coincide" : "Todavía no hay cajas"} action={filtered ? <Link href="/cajas" className="btn btn--small">Quitar filtros</Link> : undefined}>
              {filtered ? "Pruebe con otro rango de fechas, sucursal o cajero." : "Cuando se abra la primera caja aparecerá aquí."}
            </EmptyState>
          </div>
        ) : (
          <CashSessionTable sessions={rows} detailBase="/cajas" showBranch />
        )}
        <Pagination page={sessions} basePath="/cajas" label="cajas" params={{ desde: filters.from, hasta: filters.to, sucursal: filters.branchId, cajero: filters.openedBy }} />
      </section>
    </div>
  );
}
