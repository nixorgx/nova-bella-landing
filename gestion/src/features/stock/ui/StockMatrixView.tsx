import { EmptyState } from "@/components/ui/EmptyState";
import { D, dec, formatBs } from "@/lib/money";
import { stockState } from "@/lib/stock-state";
import { cellKey, type MatrixModel } from "../matrix-model";

const STATE_CLASS = { ok: "is-ok", low: "is-low", out: "is-out" } as const;

/** Stock matrix per model (color x size) with last / average cost in blue. Superadmin only. */
export function StockMatrixView({ models }: { models: readonly MatrixModel[] }) {
  if (models.length === 0) {
    return <EmptyState title="Sin productos para mostrar">Cambie el filtro o registre un lote de compra.</EmptyState>;
  }
  return (
    <div className="stack">
      {models.map((model) => (
        <section key={model.modelId} className="panel stock-model" aria-labelledby={`m-${model.modelId}`}>
          <header className="stock-model__head">
            <h2 id={`m-${model.modelId}`}>{model.model}</h2>
            <div className="stock-model__meta">
              <span>{model.line}</span>
              <span>Precio {formatBs(model.price)}</span>
              <span><strong>{model.units}</strong> pares</span>
              <span className="cost-tag">Valor a costo {formatBs(model.valueBs)}</span>
            </div>
          </header>
          <div className="smatrix-wrap" role="region" tabIndex={0} aria-label={`Existencias de ${model.model}: desplace para ver todas las tallas`}>
            <table className="smatrix">
              <caption className="sr-only">Existencias de {model.model} por color y talla, con costo</caption>
              <thead>
                <tr>
                  <th scope="col">Color</th>
                  {model.sizes.map((size) => (
                    <th key={size.id} scope="col">{size.label}</th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {model.colors.map((color) => (
                  <tr key={color.id}>
                    <th scope="row">
                      <span className="color-cell">
                        <span className="swatch" style={{ background: color.hex ?? "var(--ink-faint)" }} aria-hidden="true" />
                        {color.name}
                      </span>
                    </th>
                    {model.sizes.map((size) => {
                      const cell = model.cells[cellKey(color.id, size.id)];
                      if (!cell) return <td key={size.id} className="is-missing" aria-label="Sin variante">·</td>;
                      return (
                        <td key={size.id}>
                          <span className={`smatrix__qty ${STATE_CLASS[stockState(cell.qty)]}`}>{cell.qty}</span>
                          {cell.lastCostBs ? (
                            <span className="smatrix__cost" title={`Promedio ${formatBs(cell.avgCostBs)}`}>
                              {formatBs(cell.lastCostBs)}
                            </span>
                          ) : (
                            <span className="smatrix__cost">sin costo</span>
                          )}
                        </td>
                      );
                    })}
                    <td><span className="smatrix__qty">{color.total}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {model.sizes.map((size) => (
                    <td key={size.id}>{sizeTotal(model, size.id)}</td>
                  ))}
                  <td>{model.units}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function sizeTotal(model: MatrixModel, sizeId: string): number {
  return model.colors.reduce((sum, color) => sum + (model.cells[cellKey(color.id, sizeId)]?.qty ?? 0), 0);
}

export function inventoryValue(models: readonly MatrixModel[]): string {
  return models.reduce((sum, model) => sum.plus(dec(model.valueBs)), new D(0)).toFixed(2);
}
