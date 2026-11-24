import { HeatmapTable } from "@/components/charts/HeatmapTable";
import { RankedBars } from "@/components/charts/RankedBars";
import { EmptyState } from "@/components/ui/EmptyState";
import { toSession, type AuthUser } from "@/lib/auth/guards";
import { formatBs } from "@/lib/money";
import { buildHeatmap } from "../../aggregate";
import { getModelSizeSales, totalsByModel } from "../../queries";
import type { ReportFilters, ReportScope } from "../../scope";
import { ExportButton } from "../ExportButton";

const TOP_MODELS = 8;

/** The client's explicit request: which models AND which sizes sell the most. */
export async function ModelsView({ user, filters, scope }: { user: AuthUser; filters: ReportFilters; scope: ReportScope }) {
  const rows = await getModelSizeSales(toSession(user), scope);
  const map = buildHeatmap(rows);
  if (map.total === 0) {
    return <EmptyState title="Sin ventas en este período">Cuando haya ventas verá aquí qué modelos y qué tallas se venden más.</EmptyState>;
  }
  const models = totalsByModel(rows).slice(0, TOP_MODELS);
  const sizes = [...map.sizes].sort((a, b) => b.total - a.total || a.order - b.order).slice(0, TOP_MODELS);

  return (
    <div className="stack">
      <div className="report-actions"><ExportButton report="ventas" filters={filters} label="Descargar Excel (hoja Modelos y Matriz)" /></div>
      <div className="two-up">
        <section className="panel" aria-labelledby="top-models">
          <div className="panel__head"><h2 id="top-models">Modelos más vendidos</h2><span className="eyebrow">Pares</span></div>
          <div className="panel__body">
            <RankedBars
              label="Modelos más vendidos por pares"
              items={models.map((m) => ({ key: m.modelId, label: m.model, sub: `${m.line} · ${formatBs(m.revenue)}`, value: m.units, valueLabel: `${m.units} ${m.units === 1 ? "par" : "pares"}` }))}
            />
          </div>
        </section>
        <section className="panel" aria-labelledby="top-sizes">
          <div className="panel__head"><h2 id="top-sizes">Tallas más vendidas</h2><span className="eyebrow">Pares</span></div>
          <div className="panel__body">
            <RankedBars
              label="Tallas más vendidas por pares"
              items={sizes.map((s) => ({ key: s.label, label: `Talla ${s.label}`, value: s.total, valueLabel: `${s.total} ${s.total === 1 ? "par" : "pares"}` }))}
            />
          </div>
        </section>
      </div>
      <section className="panel" aria-labelledby="heat-title">
        <div className="panel__head">
          <h2 id="heat-title">Modelo × talla</h2>
          <span className="eyebrow">Más oscuro = más pares</span>
        </div>
        <div className="panel__body stack">
          <HeatmapTable map={map} caption="Pares vendidos por modelo y talla en el período" />
          <p className="field__hint">Las cifras descuentan los cambios: el par devuelto resta y el par entregado suma.</p>
        </div>
      </section>
    </div>
  );
}
