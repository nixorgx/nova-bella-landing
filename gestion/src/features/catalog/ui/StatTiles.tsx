import Link from "next/link";
import type { CatalogSummary } from "../queries";

const number = new Intl.NumberFormat("es-BO");

export function StatTiles({ summary }: { summary: CatalogSummary }) {
  const tiles = [
    { label: "Modelos", value: summary.activeModels, note: `${summary.models} registrados` },
    { label: "Variantes", value: summary.activeVariants, note: `${summary.variants} en total` },
    { label: "Colores", value: summary.colors, note: `${summary.lines} líneas` },
    { label: "Tallas", value: summary.sizes, note: "activas" },
    { label: "Pares en stock", value: summary.units, note: "todas las sucursales" },
  ];
  return (
    <section aria-label="Resumen del catálogo" className="stats">
      <ul className="stats__tiles">
        {tiles.map((tile) => (
          <li key={tile.label} className="tile">
            <span className="tile__label">{tile.label}</span>
            <strong className="tile__value num">{number.format(tile.value)}</strong>
            <span className="tile__note">{tile.note}</span>
          </li>
        ))}
      </ul>
      {summary.emptyModels > 0 || summary.withoutBarcode > 0 ? (
        <ul className="stats__alerts">
          {summary.emptyModels > 0 ? (
            <li className="badge badge--low">
              {summary.emptyModels} {summary.emptyModels === 1 ? "modelo sin variantes" : "modelos sin variantes"}
            </li>
          ) : null}
          {summary.withoutBarcode > 0 ? (
            <li className="badge badge--low">{summary.withoutBarcode} variantes sin código de barras</li>
          ) : null}
          <li>
            <Link href="/catalogo/etiquetas" className="link-button">
              Imprimir etiquetas
            </Link>
          </li>
        </ul>
      ) : null}
    </section>
  );
}
