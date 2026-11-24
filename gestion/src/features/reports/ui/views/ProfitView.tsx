import { RankedBars } from "@/components/charts/RankedBars";
import { EmptyState } from "@/components/ui/EmptyState";
import { toSession, type AuthUser } from "@/lib/auth/guards";
import { formatBs } from "@/lib/money";
import { getInventoryValue, getProfitByModel, getProfitSummary } from "../../cost-queries";
import type { ReportFilters, ReportScope } from "../../scope";
import { ExportButton } from "../ExportButton";
import { Kpi, KpiRow } from "../Kpi";

/** Superadmin only (the page never renders it for sellers and the queries throw for them). */
export async function ProfitView({ user, filters, scope }: { user: AuthUser; filters: ReportFilters; scope: ReportScope }) {
  const session = toSession(user);
  const [profit, models, inventory] = await Promise.all([
    getProfitSummary(session, scope),
    getProfitByModel(session, scope),
    getInventoryValue(session, scope.branchId),
  ]);
  if (models.length === 0) return <EmptyState title="Sin ventas en este período">La utilidad se calcula con las ventas del período.</EmptyState>;
  const pct = (value: string | null) => (value ? `${value.replace(".", ",")} %` : "—");

  return (
    <div className="stack">
      <div className="report-actions">
        <ExportButton cost report="rentabilidad" filters={filters} label="Descargar utilidad (Excel)" />
        <ExportButton cost report="compras" filters={filters} label="Descargar compras y costos (Excel)" />
      </div>
      <KpiRow label="Costo y utilidad del período">
        <Kpi cost hero label="Utilidad" value={formatBs(profit.profit)} note={`margen ${pct(profit.marginPct)}`} />
        <Kpi cost label="Ingresos" value={formatBs(profit.revenue)} note="ventas + diferencias de cambios" />
        <Kpi cost label="Costo de lo vendido" value={formatBs(profit.cost)} note="costo al momento de la venta" />
        <Kpi cost label="Valor del inventario" value={formatBs(inventory.value)} note={`${inventory.units} pares a costo promedio`} />
      </KpiRow>
      {profit.linesWithoutCost > 0 ? (
        <p className="notice notice--warn" role="status">
          {profit.linesWithoutCost} {profit.linesWithoutCost === 1 ? "producto vendido no tiene" : "productos vendidos no tienen"} costo registrado: se contó con costo cero.
          Registre la compra para corregir la utilidad de ahí en adelante.
        </p>
      ) : null}
      <section className="panel panel--cost" aria-labelledby="pm-title">
        <div className="panel__head"><h2 id="pm-title">Utilidad por modelo</h2><span className="eyebrow cost">Solo superadmin</span></div>
        <div className="panel__body stack">
          <RankedBars
            tone="cost"
            label="Utilidad por modelo"
            items={models.slice(0, 8).map((m) => ({ key: m.modelId, label: m.model, sub: `${m.units} pares · margen ${pct(m.marginPct)}`, value: Math.max(0, Number(m.profit)), valueLabel: formatBs(m.profit) }))}
          />
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr><th scope="col">Modelo</th><th scope="col" className="num">Pares</th><th scope="col" className="num">Ingreso</th><th scope="col" className="num">Costo</th><th scope="col" className="num">Utilidad</th><th scope="col" className="num">Margen</th></tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.modelId}>
                    <th scope="row" data-label="Modelo">{m.model}</th>
                    <td data-label="Pares" className="num">{m.units}</td>
                    <td data-label="Ingreso" className="num">{formatBs(m.revenue)}</td>
                    <td data-label="Costo" className="num cost">{formatBs(m.cost)}</td>
                    <td data-label="Utilidad" className="num"><strong>{formatBs(m.profit)}</strong></td>
                    <td data-label="Margen" className="num">{pct(m.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field__hint">
            El costo de cada par es el costo promedio puesto en tienda <strong>en el momento de la venta</strong>: compras posteriores no cambian
            la utilidad de períodos pasados. En un cambio se resta el costo del par devuelto y se suma el del par entregado.
          </p>
        </div>
      </section>
    </div>
  );
}
