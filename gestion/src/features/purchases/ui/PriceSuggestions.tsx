import { EmptyState } from "@/components/ui/EmptyState";
import { formatBs } from "@/lib/money";
import { evaluatePrice } from "../pricing";
import type { ModelCost } from "../model-costs";
import { ApplyPrice } from "./ApplyPrice";

interface Props {
  readonly models: readonly ModelCost[];
  readonly targetMarginPct: string;
  readonly onlyBelowTarget?: boolean;
}

const pct = (value: string | null) => (value === null ? "—" : `${value.replace(".", ",")}%`);

/** Suggested sale price per model vs the current one. A suggestion: applying needs explicit confirmation. */
export function PriceSuggestions({ models, targetMarginPct, onlyBelowTarget = false }: Props) {
  const rows = models
    .map((model) => ({ model, result: evaluatePrice({ currentPrice: model.currentPrice, costBs: model.lastCostBs, targetMarginPct }) }))
    .filter((row) => !onlyBelowTarget || row.result.belowTarget);

  if (rows.length === 0) {
    return (
      <EmptyState title={onlyBelowTarget ? "Ningún modelo está bajo el margen" : "Sin costos todavía"}>
        {onlyBelowTarget
          ? `Todos los precios cumplen el margen objetivo de ${targetMarginPct.replace(".", ",")}%.`
          : "Los costos aparecen cuando se registra el primer lote de compra."}
      </EmptyState>
    );
  }
  return (
    <div>
      {rows.map(({ model, result }) => (
        <article key={model.modelId} className="price-card" aria-label={`Precio sugerido de ${model.model}`}>
          <div className="price-card__head">
            <h3 className="price-card__name">{model.model}</h3>
            <span className="eyebrow">{model.line}</span>
            {result.belowTarget ? (
              <span className="badge badge--low">Margen bajo el objetivo</span>
            ) : (
              <span className="badge badge--ok">Margen en regla</span>
            )}
          </div>
          <dl className="price-card__grid">
            <div><dt>Costo actual (Bs)</dt><dd className="cost">{formatBs(model.lastCostBs)}</dd></div>
            <div><dt>Precio actual</dt><dd>{formatBs(model.currentPrice)}</dd></div>
            <div>
              <dt>Margen actual</dt>
              <dd className={result.belowTarget ? "margin-warn" : undefined}>{pct(result.currentMargin)}</dd>
            </div>
            <div className="is-new"><dt>Precio sugerido</dt><dd>{formatBs(result.suggestedPrice)}</dd></div>
          </dl>
          <p className="field__hint">
            Con margen objetivo de {targetMarginPct.replace(".", ",")}% el precio sugerido deja {pct(result.suggestedMargin)}. Costo promedio {formatBs(model.avgCostBs)}.
          </p>
          <details>
            <summary>Costo por variante ({model.variants.length})</summary>
            <div className="table-wrap">
              <table className="table table--cost">
                <thead>
                  <tr><th scope="col">SKU</th><th scope="col">Color</th><th scope="col" className="num">Talla</th><th scope="col" className="num">Último</th><th scope="col" className="num">Promedio</th></tr>
                </thead>
                <tbody>
                  {model.variants.map((variant) => (
                    <tr key={variant.sku}>
                      <td><code className="sku">{variant.sku}</code></td>
                      <td>{variant.color}</td>
                      <td className="num">{variant.size}</td>
                      <td className="num cost">{formatBs(variant.lastCostBs)}</td>
                      <td className="num cost">{formatBs(variant.avgCostBs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {result.belowTarget ? (
            <ApplyPrice modelId={model.modelId} model={model.model} currentPrice={model.currentPrice} suggestedPrice={result.suggestedPrice} />
          ) : null}
        </article>
      ))}
    </div>
  );
}
