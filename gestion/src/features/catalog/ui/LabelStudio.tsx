"use client";

import { useMemo, useState } from "react";
import { VariantSearch } from "@/components/search/VariantSearch";
import { EmptyState } from "@/components/ui/EmptyState";
import { LabelPages } from "../labels/LabelPages";
import {
  expandLabels,
  LABEL_PRESETS,
  labelsPerPage,
  MAX_LABELS,
  pageCss,
  paginate,
  presetById,
  type LabelItem,
} from "../labels/presets";
import { useLabelImages } from "../labels/useLabelImages";
import type { VariantHit } from "../types";

export interface ModelOption {
  readonly id: string;
  readonly name: string;
  readonly line: string;
}

interface Props {
  readonly models: readonly ModelOption[];
  readonly initialItems: readonly LabelItem[];
  readonly initialModelId?: string;
  /** CSP nonce of this request: the print stylesheet below is an inline <style> element. */
  readonly nonce?: string;
}

const MAX_QTY = 99;

function toItem(hit: VariantHit): LabelItem {
  return {
    variantId: hit.variantId,
    sku: hit.sku,
    barcode: hit.barcode,
    model: hit.model,
    color: hit.color,
    size: hit.size,
    price: hit.price,
    stock: hit.stock,
    qty: 1,
  };
}

function mergeItems(current: readonly LabelItem[], incoming: readonly LabelItem[]): LabelItem[] {
  const known = new Set(current.map((item) => item.variantId));
  return [...current, ...incoming.filter((item) => !known.has(item.variantId))];
}

const clampQty = (qty: number) => Math.min(MAX_QTY, Math.max(0, qty));

export function LabelStudio({ models, initialItems, initialModelId, nonce }: Props) {
  const [items, setItems] = useState<readonly LabelItem[]>(initialItems);
  const [presetId, setPresetId] = useState(LABEL_PRESETS[0].id);
  const [showPrice, setShowPrice] = useState(true);
  const [modelId, setModelId] = useState(initialModelId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const preset = presetById(presetId);
  const labels = useMemo(() => expandLabels(items), [items]);
  const { images, failed } = useLabelImages(labels);
  const total = items.reduce((sum, item) => sum + item.qty, 0);
  const pageCount = paginate(labels, preset).length;

  async function addModel() {
    if (!modelId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/variantes/buscar?modelo=${modelId}&limite=200`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { hits: VariantHit[] };
      if (data.hits.length === 0) setError("Ese modelo todavía no tiene variantes activas.");
      setItems((current) => mergeItems(current, data.hits.map(toItem)));
    } catch {
      setError("No se pudieron cargar las variantes del modelo. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }

  const setQty = (variantId: string, qty: number) =>
    setItems((current) => current.map((item) => (item.variantId === variantId ? { ...item, qty: clampQty(qty) } : item)));
  const remove = (variantId: string) => setItems((current) => current.filter((item) => item.variantId !== variantId));
  const setAll = (pick: (item: LabelItem) => number) =>
    setItems((current) => current.map((item) => ({ ...item, qty: clampQty(pick(item)) })));

  return (
    <div className="studio">
      <style nonce={nonce}>{pageCss(preset)}</style>
      <div className="studio__controls no-print">
        <section className="panel" aria-labelledby="pick-title">
          <div className="panel__head"><h2 id="pick-title">1 · Qué etiquetas</h2></div>
          <div className="panel__body stack">
            <div className="model-pick">
              <div className="field">
                <label className="field__label" htmlFor="label-model">Modelo completo</label>
                <select id="label-model" className="field__control" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  <option value="">Seleccione un modelo…</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.line} · {model.name}</option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn" onClick={addModel} disabled={!modelId || loading}>
                {loading ? "Agregando…" : "Agregar todas sus variantes"}
              </button>
            </div>
            {error ? <p className="field__error" role="alert">{error}</p> : null}
            <VariantSearch
              scanner
              includeInactive
              label="…o busque una variante suelta"
              onSelect={(hit) => setItems((current) => mergeItems(current, [toItem(hit)]))}
            />
          </div>
        </section>

        <section className="panel" aria-labelledby="qty-title">
          <div className="panel__head">
            <h2 id="qty-title">2 · Cantidad por variante</h2>
            <span className="eyebrow">{items.length} variantes</span>
          </div>
          <div className="panel__body stack">
            {items.length === 0 ? (
              <EmptyState title="Aún no eligió nada">Agregue un modelo completo o busque variantes sueltas arriba.</EmptyState>
            ) : (
              <>
                <div className="chips">
                  <button type="button" className="chip" onClick={() => setAll(() => 1)}>1 por variante</button>
                  <button type="button" className="chip" onClick={() => setAll((item) => item.stock ?? 1)}>Igual al stock</button>
                  <button type="button" className="chip" onClick={() => setItems([])}>Vaciar lista</button>
                </div>
                <ul className="qty-list">
                  {items.map((item) => (
                    <li key={item.variantId} className="qty-row">
                      <span className="qty-row__name">
                        <strong className="clip">{item.model}</strong>
                        <span className="clip">{item.color} · Talla {item.size}</span>
                        <code className="clip">{item.sku}</code>
                      </span>
                      <span className="qty-row__input">
                        <button type="button" className="btn btn--small" aria-label={`Menos ${item.sku}`} onClick={() => setQty(item.variantId, item.qty - 1)}>−</button>
                        <input
                          className="field__control num"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={MAX_QTY}
                          aria-label={`Cantidad de ${item.sku}`}
                          value={item.qty}
                          onChange={(e) => setQty(item.variantId, Number(e.target.value) || 0)}
                        />
                        <button type="button" className="btn btn--small" aria-label={`Más ${item.sku}`} onClick={() => setQty(item.variantId, item.qty + 1)}>+</button>
                      </span>
                      <button type="button" className="btn btn--small btn--quiet" onClick={() => remove(item.variantId)}>
                        Quitar<span className="sr-only"> {item.sku}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="fmt-title">
          <div className="panel__head"><h2 id="fmt-title">3 · Formato</h2></div>
          <div className="panel__body stack">
            <fieldset className="presets">
              <legend className="field__label">Tamaño de etiqueta</legend>
              {LABEL_PRESETS.map((option) => (
                <label key={option.id} className="preset">
                  <input type="radio" name="preset" value={option.id} checked={presetId === option.id} onChange={() => setPresetId(option.id)} />
                  <span>
                    <strong>{option.name}</strong>
                    <small>{option.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
              <span>Mostrar precio en la etiqueta</span>
            </label>
          </div>
        </section>
      </div>

      <section className="panel studio__preview" aria-labelledby="prev-title">
        <div className="panel__head no-print">
          <h2 id="prev-title">Vista previa</h2>
          <button type="button" className="btn btn--primary" onClick={() => window.print()} disabled={labels.length === 0}>
            Imprimir / Guardar PDF
          </button>
        </div>
        <div className="panel__body stack">
          <p className="field__hint no-print" role="status" aria-live="polite">
            {labels.length === 0
              ? "La vista previa aparece cuando agregue etiquetas."
              : `${total} ${total === 1 ? "etiqueta" : "etiquetas"} · ${pageCount} ${pageCount === 1 ? "página" : "páginas"} · ${labelsPerPage(preset)} por página`}
            {total > MAX_LABELS ? ` (se imprimen las primeras ${MAX_LABELS})` : ""}
            {failed ? " · No se pudieron generar los códigos." : ""}
          </p>
          {labels.length === 0 ? null : <LabelPages labels={labels} preset={preset} images={images} showPrice={showPrice} />}
        </div>
      </section>
    </div>
  );
}
