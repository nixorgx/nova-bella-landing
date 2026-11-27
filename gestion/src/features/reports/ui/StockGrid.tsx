import { stockState, STOCK_LABEL } from "@/lib/stock-state";
import { buildStockMatrix, cellKey } from "@/features/stock/matrix-model";
import type { StockVariantRow } from "../queries";

const STATE_CLASS = { ok: "is-ok", low: "is-low", out: "is-out" } as const;

/** Stock per model: colors x sizes with quantities. NO cost is read or drawn here (seller-safe). */
export function StockGrid({ rows }: { rows: readonly StockVariantRow[] }) {
  const models = buildStockMatrix(
    rows.map((row) => ({ ...row, lastCostBs: null, avgCostBs: null, colorHex: row.colorHex, sizeOrder: row.sizeOrder })),
  );
  return (
    <div className="stack">
      {models.map((model) => (
        <section key={model.modelId} className="panel stock-model" aria-labelledby={`sg-${model.modelId}`}>
          <header className="stock-model__head">
            <h3 id={`sg-${model.modelId}`}>{model.model}</h3>
            <div className="stock-model__meta">
              <span>{model.line}</span>
              <span><strong>{model.units}</strong> pares</span>
            </div>
          </header>
          <div className="smatrix-wrap" role="region" tabIndex={0} aria-label={`Existencias de ${model.model}: desplace para ver todas las tallas`}>
            <table className="smatrix">
              <caption className="sr-only">Existencias de {model.model} por color y talla</caption>
              <thead>
                <tr>
                  <th scope="col">Color</th>
                  {model.sizes.map((size) => <th key={size.id} scope="col">{size.label}</th>)}
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
                          <span className={`smatrix__qty ${STATE_CLASS[stockState(cell.qty)]}`} title={STOCK_LABEL[stockState(cell.qty)]}>{cell.qty}</span>
                        </td>
                      );
                    })}
                    <td><span className="smatrix__qty">{color.total}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
