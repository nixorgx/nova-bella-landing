"use client";

import { VariantSearch } from "@/components/search/VariantSearch";
import type { VariantHit } from "@/features/catalog/types";
import { formatBs } from "@/lib/money";
import type { PreviewRow } from "../form-math";
import { BulkPaste } from "./BulkPaste";
import type { BatchItemState } from "./draft-state";

interface Props {
  readonly branchId: string;
  readonly items: readonly BatchItemState[];
  readonly rows: readonly PreviewRow[];
  readonly onPick: (hit: VariantHit) => void;
  readonly onPatch: (variantId: string, patch: { qtyInput?: string; costInput?: string }) => void;
  readonly onRemove: (variantId: string) => void;
  readonly onBulk: (hits: readonly { hit: VariantHit; qtyInput: string; costInput: string }[]) => void;
}

export function BatchItemsPanel({ branchId, items, rows, onPick, onPatch, onRemove, onBulk }: Props) {
  return (
    <section className="panel" aria-labelledby="items-title">
      <div className="panel__head">
        <h2 id="items-title">Productos del lote</h2>
        <span className="eyebrow">{items.length} {items.length === 1 ? "producto" : "productos"}</span>
      </div>
      <div className="panel__body stack">
        <VariantSearch
          scanner
          autoFocus
          branchId={branchId}
          label="Escanear o buscar producto"
          placeholder="Escanee el código o escriba SKU, modelo, color, talla…"
          onSelect={onPick}
        />
        {items.length === 0 ? (
          <p className="items-empty">Escanee o busque el primer producto. Si ya trae el código de barras de la caja, basta con escanearlo.</p>
        ) : (
          <ul className="batch-items" aria-label="Productos agregados">
            {items.map((item, index) => (
              <ItemRow key={item.variantId} item={item} row={rows[index]} onPatch={onPatch} onRemove={onRemove} />
            ))}
          </ul>
        )}
        <BulkPaste onResolved={onBulk} />
      </div>
    </section>
  );
}

function ItemRow({
  item,
  row,
  onPatch,
  onRemove,
}: {
  item: BatchItemState;
  row: PreviewRow | undefined;
  onPatch: Props["onPatch"];
  onRemove: Props["onRemove"];
}) {
  const label = `${item.model} ${item.color} talla ${item.size}`;
  return (
    <li className="batch-item">
      <div className="batch-item__name">
        <strong>{item.model}</strong>
        <span className="color-cell">
          <span className="swatch" style={{ background: item.colorHex ?? "var(--ink-faint)" }} aria-hidden="true" />
          <span className="clip">{item.color} · Talla {item.size}</span>
        </span>
        <code className="sku">{item.sku}</code>
        <span className="field__hint">En stock: {item.stock}</span>
      </div>
      <div className="batch-item__fields">
        <div className="field">
          <label className="field__label" htmlFor={`qty-${item.variantId}`}>Cantidad</label>
          <input
            id={`qty-${item.variantId}`}
            className="field__control num"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Cantidad de ${label}`}
            value={item.qtyInput}
            aria-invalid={row?.qty === null ? true : undefined}
            onChange={(event) => onPatch(item.variantId, { qtyInput: event.target.value })}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`cost-${item.variantId}`}>Costo USD</label>
          <input
            id={`cost-${item.variantId}`}
            className="field__control num"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            aria-label={`Costo unitario en USD de ${label}`}
            value={item.costInput}
            aria-invalid={row?.costUsd === null ? true : undefined}
            onChange={(event) => onPatch(item.variantId, { costInput: event.target.value })}
          />
        </div>
      </div>
      <div className="batch-item__out" aria-live="polite">
        <span className="field__hint">Bs por unidad</span>
        <strong>{row?.unitBs ? formatBs(row.unitBs) : "—"}</strong>
        <span className="field__hint">{row?.lineBs ? `Línea ${formatBs(row.lineBs)}` : " "}</span>
      </div>
      <button type="button" className="btn btn--small btn--quiet" onClick={() => onRemove(item.variantId)} aria-label={`Quitar ${label}`}>
        Quitar
      </button>
      {row?.error ? (
        <p className="field__error batch-item__row-error" role="alert">
          {row.error}
        </p>
      ) : null}
    </li>
  );
}
