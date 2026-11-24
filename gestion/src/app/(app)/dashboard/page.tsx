import type { Metadata } from "next";
import Link from "next/link";
import { DailyChart } from "@/components/charts/DailyChart";
import { RankedBars } from "@/components/charts/RankedBars";
import { BranchFilterForm } from "@/components/ui/BranchFilterForm";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDate, formatTime } from "@/lib/format";
import { formatBs } from "@/lib/money";
import type { RawSearchParams } from "@/lib/search-params";
import { branchFilterFor } from "@/features/branches/scope";
import { listBranchOptions } from "@/features/branches/queries";
import {
  getDashboard,
  MOVEMENT_LABEL,
} from "@/features/reports/dashboard-queries";
import { Delta, Kpi, KpiRow } from "@/features/reports/ui/Kpi";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const params = await searchParams;
  const branchId = branchFilterFor(user, params.sucursal);
  const [data, branches] = await Promise.all([
    getDashboard(session, undefined, branchId),
    listBranchOptions(session, { includeInactive: true }),
  ]);
  const branchQuery = branchId ? `&sucursal=${branchId}` : "";
  const branchName = branches.find((b) => b.id === branchId)?.name;
  const { month, previousMonth, profit } = data;
  const lowTotal = data.outCount + data.lowCount;

  return (
    <div className="page page--wide dash">
      <PageHead
        eyebrow={formatDate(`${data.today}T12:00:00-04:00`)}
        title={`Hola, ${user.fullName.split(" ")[0]}`}
        description={`${branchName ? `Sucursal ${branchName}. ` : ""}Cómo va el mes frente al anterior, la caja de hoy y lo que hay que reponer.`}
      >
        <BranchFilterForm action="/dashboard" branches={branches} selected={branchId} />
      </PageHead>

      <KpiRow label="Resumen del mes">
        <Kpi
          hero
          label="Ventas del mes"
          value={formatBs(month.amount)}
          note={`${month.count} ventas · ${month.units} pares · mes anterior al mismo día: ${formatBs(previousMonth.amount)}`}
        >
          <Delta
            current={month.amount}
            previous={previousMonth.amount}
            label="vs mes anterior"
          />
        </Kpi>
        <Kpi
          cost
          label="Utilidad del mes"
          value={formatBs(profit.profit)}
          note={
            profit.marginPct
              ? `margen ${profit.marginPct.replace(".", ",")} %`
              : "solo superadmin"
          }
        />
        <Kpi
          label="Stock bajo"
          value={String(lowTotal)}
          note={`${data.outCount} agotadas · ${data.lowCount} con pocos pares`}
        />
        <Kpi
          label="Caja abierta hoy"
          value={String(data.openCash.length)}
          note={
            data.openCash.length === 0
              ? "ninguna sucursal abierta"
              : data.openCash.map((c) => c.branchName).join(", ")
          }
        />
      </KpiRow>

      <div className="dash__grid">
        <div className="dash__main">
          <section
            className="panel"
            aria-label="Ventas del mes frente al mes anterior"
          >
            <div className="panel__body">
              <DailyChart
                title="Ventas por día"
                seriesLabel="Este mes"
                points={data.daily}
                compare={{ label: "Mes anterior", points: data.previousDaily }}
              />
            </div>
          </section>

          <section className="panel" aria-labelledby="top-title">
            <div className="panel__head">
              <h2 id="top-title">Modelos más vendidos del mes</h2>
              <Link className="row-link" href={`/reportes?vista=modelos${branchQuery}`}>
                Modelos y tallas
              </Link>
            </div>
            <div className="panel__body">
              {data.topModels.length === 0 ? (
                <p className="is-muted">Todavía no hay ventas este mes.</p>
              ) : (
                <RankedBars
                  label="Modelos más vendidos del mes"
                  items={data.topModels.map((m) => ({
                    key: m.modelId,
                    label: m.model,
                    sub: formatBs(m.revenue),
                    value: m.units,
                    valueLabel: `${m.units} ${m.units === 1 ? "par" : "pares"}`,
                  }))}
                />
              )}
            </div>
          </section>
        </div>

        <aside className="stack" aria-label="Caja y reposición">
          <section className="panel" aria-labelledby="till-title">
            <div className="panel__head">
              <h2 id="till-title">Caja de hoy</h2>
              <Link className="row-link" href={branchId ? `/cajas?sucursal=${branchId}` : "/cajas"}>
                Ver cajas
              </Link>
            </div>
            <div className="panel__body">
              {data.openCash.length === 0 ? (
                <p className="notice notice--warn">
                  Ninguna caja está abierta. Las ventas se habilitan al abrir la
                  caja.
                </p>
              ) : (
                <ul className="till">
                  {data.openCash.map((cash) => (
                    <li key={cash.id} data-state="open">
                      <strong>{cash.branchName}</strong>
                      <span>
                        Abierta {formatTime(cash.openedAt)}
                        {cash.openedByName ? ` por ${cash.openedByName}` : ""}
                      </span>
                      <span className="num">
                        {cash.salesCount}{" "}
                        {cash.salesCount === 1 ? "venta" : "ventas"} ·{" "}
                        {formatBs(cash.salesTotal)} · efectivo esperado{" "}
                        {formatBs(cash.expectedCash)}
                      </span>
                      <Link className="row-link" href={`/cajas/${cash.id}`}>
                        Ver el detalle
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="low-title">
            <div className="panel__head">
              <h2 id="low-title">Para reponer</h2>
              <Link className="row-link" href={`/reportes?vista=stock${branchQuery}`}>
                Ver stock
              </Link>
            </div>
            {data.lowStock.length === 0 ? (
              <div className="panel__body">
                <p className="is-muted">
                  Todo el catálogo tiene stock suficiente.
                </p>
              </div>
            ) : (
              <div className="dash__body">
                <ul className="plain-list">
                  {data.lowStock.map((row) => (
                    <li key={row.sku}>
                      <strong className="clip-2">{row.model}</strong>
                      <span className="is-muted">
                        {row.color} · Talla {row.size}
                      </span>
                      <span
                        className={`badge badge--${row.qty <= 0 ? "out" : "low"}`}
                      >
                        {row.qty <= 0
                          ? "Agotado"
                          : `${row.qty} ${row.qty === 1 ? "par" : "pares"}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </aside>
      </div>

      <section className="panel" aria-labelledby="mov-title">
        <div className="panel__head">
          <h2 id="mov-title">Últimos movimientos de stock</h2>
        </div>
        <div className="dash__body">
          <ul className="movements">
            {data.movements.map((move) => (
              <li key={move.id}>
                <span
                  className="movements__qty num"
                  data-sign={move.qty > 0 ? "in" : "out"}
                >
                  {move.qty > 0 ? `+${move.qty}` : move.qty}
                </span>
                <span>
                  <strong className="clip-2">{move.product}</strong>
                  <small>
                    {MOVEMENT_LABEL[move.type] ?? move.type} · {move.branchName}
                    {move.userName ? ` · ${move.userName}` : ""}
                  </small>
                </span>
                <time className="is-muted num" dateTime={move.createdAt}>
                  {formatTime(move.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
