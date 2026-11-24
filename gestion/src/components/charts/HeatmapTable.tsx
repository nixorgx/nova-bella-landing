import { heatIntensity, type Heatmap } from "@/features/reports/aggregate";

/**
 * Model x size grid of pairs sold. It is a real table (headers, totals) shaded with ONE hue by
 * quantity, so the "what size do we sell most" answer is visible at a glance and readable by number.
 */
export function HeatmapTable({ map, caption }: { map: Heatmap; caption: string }) {
  return (
    <div className="heat-wrap" role="region" tabIndex={0} aria-label={`${caption}: desplace para ver todas las columnas`}>
      <table className="heat">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Modelo</th>
            {map.sizes.map((size) => (
              <th key={size.label} scope="col" className="num">{size.label}</th>
            ))}
            <th scope="col" className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {map.models.map((model) => (
            <tr key={model.model}>
              <th scope="row"><span className="clip-2">{model.model}</span></th>
              {map.sizes.map((size) => {
                const units = model.cells[size.label] ?? 0;
                const level = heatIntensity(units, map.max);
                return (
                  <td
                    key={size.label}
                    className="num heat__cell"
                    data-dark={level > 0.55 ? "" : undefined}
                    style={{ "--i": level.toFixed(3) } as React.CSSProperties}
                  >
                    {units > 0 ? units : <span aria-label="Ninguno">·</span>}
                  </td>
                );
              })}
              <td className="num heat__total">{model.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {map.sizes.map((size) => (
              <td key={size.label} className="num">{size.total}</td>
            ))}
            <td className="num heat__total">{map.total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
