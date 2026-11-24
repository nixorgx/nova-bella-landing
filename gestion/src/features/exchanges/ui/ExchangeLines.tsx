"use client";

import { VariantSearch } from "@/components/search/VariantSearch";
import { formatBs } from "@/lib/money";
import type { PreviewLine } from "../preview";
import type { ReturnableLine } from "../queries";
import { setQty, setReplacement, toggleLine, type Draft } from "./exchange-state";
import type { VariantHit } from "@/features/catalog/types";

interface Props {
  readonly lines: readonly ReturnableLine[];
  readonly draft: Draft;
  readonly onChange: (next: Draft) => void;
  readonly branchId: string;
  readonly isAdmin: boolean;
  readonly preview: ReadonlyMap<string, PreviewLine>;
}

const toReplacement = (hit: VariantHit) => ({
  variantId: hit.variantId,
  label: `${hit.model} ${hit.color} talla ${hit.size}`,
  price: hit.price,
  stock: hit.stock,
});

/** Step 1 and 2: which pairs come back, and what the customer takes instead. */
export function ExchangeLines({ lines, draft, onChange, branchId, isAdmin, preview }: Props) {
  return (
    <ol className="xlines">
      {lines.map((line) => {
        const picked = draft[line.variantId];
        const exhausted = line.remaining === 0;
        const checkId = `x-${line.variantId}`;
        const checked = Boolean(picked);
        const shown = preview.get(line.variantId);
        return (
          <li key={line.variantId} className="xline" data-selected={checked ? "" : undefined} data-exhausted={exhausted ? "" : undefined}>
            <div className="xline__head">
              <input
                id={checkId}
                type="checkbox"
                className="xline__check"
                checked={checked}
                disabled={exhausted}
                onChange={() => onChange(toggleLine(draft, line.variantId))}
              />
              <label htmlFor={checkId} className="xline__label">
                <strong className="clip-2">{line.model}</strong>
                <span>{line.color} · Talla {line.size} · pagó {formatBs(line.paidUnit)} c/u</span>
                <span className="is-muted">
                  {exhausted ? "Ya se cambió por completo" : `Se vendieron ${line.sold}${line.exchanged ? ` · ya cambiados ${line.exchanged}` : ""} · se pueden cambiar ${line.remaining}`}
                </span>
              </label>
              {checked && line.remaining > 1 ? (
                <div className="stepper" role="group" aria-label={`Cantidad a devolver de ${line.model} talla ${line.size}`}>
                  <button type="button" className="btn" aria-label="Una menos" onClick={() => onChange(setQty(draft, line.variantId, picked.qty - 1, line.remaining))} disabled={picked.qty <= 1}>−</button>
                  <input className="field__control num" inputMode="numeric" aria-label={`Pares devueltos de ${line.model} talla ${line.size}`} value={picked.qty} onChange={(event) => onChange(setQty(draft, line.variantId, Number(event.target.value), line.remaining))} />
                  <button type="button" className="btn" aria-label="Una más" onClick={() => onChange(setQty(draft, line.variantId, picked.qty + 1, line.remaining))} disabled={picked.qty >= line.remaining}>+</button>
                </div>
              ) : null}
            </div>

            {checked ? (
              <div className="xline__swap">
                <span className="xline__arrow" aria-hidden="true">→</span>
                {picked.replacement ? (
                  <div className="chosen">
                    <span className="chosen__text">
                      <strong>{picked.replacement.label}</strong>
                      <span>Precio de lista {formatBs(picked.replacement.price)} · stock {picked.replacement.stock}</span>
                    </span>
                    <button type="button" className="btn btn--small btn--quiet" onClick={() => onChange(setReplacement(draft, line.variantId, null))}>Cambiar</button>
                  </div>
                ) : (
                  <VariantSearch
                    label={`Cambiar ${line.model} talla ${line.size} por…`}
                    placeholder="Escanee o busque la talla o el modelo nuevo"
                    scanner
                    clearOnSelect
                    branchId={isAdmin ? branchId : undefined}
                    onSelect={(hit) => onChange(setReplacement(draft, line.variantId, toReplacement(hit)))}
                  />
                )}
                {shown?.issue ? <p className="field__error" role="alert">{shown.issue}</p> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
