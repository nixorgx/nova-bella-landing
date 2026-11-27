import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { toSession, type AuthUser } from "@/lib/auth/guards";
import { formatBs } from "@/lib/money";
import { LOW_STOCK_THRESHOLD, stockState } from "@/lib/stock-state";
import { getInventoryValue } from "../../cost-queries";
import { getStockVariants } from "../../queries";
import type { ReportFilters, ReportScope } from "../../scope";
import { ExportButton } from "../ExportButton";
import { Kpi, KpiRow } from "../Kpi";
import { StockGrid } from "../StockGrid";

const ATTENTION_LIMIT = 24;

/** Current stock (not period-based): grid per model, low/out alerts and, for the superadmin, its value at cost. */
export async function StockView({ user, filters, scope }: { user: AuthUser; filters: ReportFilters; scope: ReportScope }) {
  const session = toSession(user);
  const [rows, value] = await Promise.all([
    getStockVariants(session, scope.branchId),
    user.role === "superadmin" ? getInventoryValue(session, scope.branchId) : Promise.resolve(null),
  ]);
  if (rows.length === 0) return <EmptyState title="Todavía no hay productos">Registre un lote de compra para ver el stock aquí.</EmptyState>;

  const units = rows.reduce((sum, r) => sum + r.qty, 0);
  const out = rows.filter((r) => stockState(r.qty) === "out");
  const low = rows.filter((r) => stockState(r.qty) === "low");
  const attention = [...out, ...low].slice(0, ATTENTION_LIMIT);

  return (
    <div className="stack">
      <div className="report-actions"><ExportButton report="stock" filters={filters} /></div>
      <KpiRow label="Resumen de stock">
        <Kpi hero label="Pares en stock" value={String(units)} note={`${rows.length} variantes activas`} />
        <Kpi label="Stock bajo" value={String(low.length)} note={`${LOW_STOCK_THRESHOLD} pares o menos`} />
        <Kpi label="Agotadas" value={String(out.length)} note="variantes en cero" />
        {value ? <Kpi cost label="Valor del inventario" value={formatBs(value.value)} note={value.variantsWithoutCost > 0 ? `${value.variantsWithoutCost} sin costo · solo superadmin` : "a costo promedio · solo superadmin"} /> : null}
      </KpiRow>

      <section className="panel" aria-labelledby="attn-title">
        <div className="panel__head"><h2 id="attn-title">Stock bajo y agotado</h2><span className="eyebrow">{out.length + low.length} variantes</span></div>
        {attention.length === 0 ? (
          <div className="panel__body"><p className="is-muted">Todo el catálogo tiene stock suficiente.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr><th scope="col">Producto</th><th scope="col">SKU</th><th scope="col" className="num">Pares</th><th scope="col">Estado</th></tr>
              </thead>
              <tbody>
                {attention.map((row) => {
                  const state = stockState(row.qty);
                  return (
                    <tr key={row.sku}>
                      <td data-label="Producto"><strong className="clip-2">{row.model}</strong><span className="is-muted">{row.color} · Talla {row.size}</span></td>
                      <td data-label="SKU"><code className="sku">{row.sku}</code></td>
                      <td data-label="Pares" className="num">{row.qty}</td>
                      <td data-label="Estado"><span className={`badge badge--${state}`}>{state === "out" ? "Agotado" : "Stock bajo"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {out.length + low.length > attention.length ? (
          <p className="panel__foot">Se muestran {attention.length} de {out.length + low.length}. <Link href="/stock" className="row-link">Ver todo el stock</Link></p>
        ) : null}
      </section>

      <section aria-labelledby="grid-title" className="stack">
        <h2 id="grid-title" className="section-title">Stock actual por modelo, talla y color</h2>
        <StockGrid rows={rows} />
      </section>
    </div>
  );
}
