import { dec, formatBs } from "@/lib/money";
import type { BatchPreview } from "../form-math";

const fmtUsd = (value: string) => `USD ${value.replace(".", ",")}`;

/** Live landed-cost preview: the same numbers create_purchase_batch will store. */
export function BatchPreviewPanel({ preview }: { preview: BatchPreview }) {
  const problems = [
    ...Object.values(preview.errors).filter(Boolean),
    ...preview.rows.filter((row) => row.error).map((row, i) => `Producto ${i + 1}: ${row.error}`),
  ] as string[];
  const average = preview.totalUnits > 0 ? formatBs(dec(preview.totalBs).div(preview.totalUnits).toFixed(2)) : "—";
  return (
    <section className={`preview ${preview.ready ? "" : "is-stale"}`} aria-labelledby="preview-title">
      <p className="preview__title" id="preview-title">
        <span className="cost-tag">Costo · solo superadmin</span>
      </p>
      <div>
        <p className="field__hint">Costo total del lote (puesto en Bs)</p>
        <p className="preview__total" aria-live="polite" data-testid="batch-total">
          {formatBs(preview.totalBs)}
        </p>
      </div>
      <dl className="preview__rows">
        <div><dt>Unidades</dt><dd>{preview.totalUnits}</dd></div>
        <div><dt>Total en USD</dt><dd>{fmtUsd(preview.totalUsd)}</dd></div>
        <div><dt>TC combinado</dt><dd>{preview.blendedRate ? preview.blendedRate.replace(".", ",") : "—"}</dd></div>
        <div><dt>Flete por unidad</dt><dd>{formatBs(preview.freightPerUnit)}</dd></div>
        <div><dt>Costo medio por unidad</dt><dd>{average}</dd></div>
      </dl>
      {problems.length > 0 ? (
        <ul className="preview__problems" aria-label="Pendientes">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
