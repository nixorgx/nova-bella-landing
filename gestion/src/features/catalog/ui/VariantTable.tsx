"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/form/ActionForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { STOCK_LABEL, stockState } from "@/lib/stock-state";
import { setVariantBarcodeAction } from "../model-actions";
import type { VariantHit } from "../types";
import { ActiveToggle } from "./ActiveToggle";
import { BarcodeField } from "./BarcodeField";

type Filter = "all" | "no-barcode" | "inactive";

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "no-barcode", label: "Sin código de barras" },
  { id: "inactive", label: "Inactivas" },
];

function matches(variant: VariantHit, filter: Filter): boolean {
  if (filter === "no-barcode") return variant.barcode === null;
  if (filter === "inactive") return !variant.active;
  return true;
}

export function VariantTable({ variants, highlightId }: { variants: readonly VariantHit[]; highlightId?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, variants.filter((v) => matches(v, f.id)).length])),
    [variants],
  );
  const visible = variants.filter((variant) => matches(variant, filter));

  if (variants.length === 0) {
    return (
      <EmptyState title="Este modelo aún no tiene variantes">
        Use el generador de arriba: marque los colores y tallas y se crean todas las combinaciones de una vez.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      <div className="chips" role="group" aria-label="Filtrar variantes">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label} <span className="num">{counts[item.id]}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <EmptyState title="Nada con ese filtro">Todas las variantes cumplen lo contrario. Pruebe otro filtro.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table table--stack variants-table">
            <thead>
              <tr>
                <th scope="col">Color</th>
                <th scope="col">Talla</th>
                <th scope="col">SKU</th>
                <th scope="col">Código de barras</th>
                <th scope="col" className="num">Stock</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((variant) => {
                const state = stockState(variant.stock);
                return (
                  <tr
                    key={variant.variantId}
                    id={`v-${variant.variantId}`}
                    className={[variant.active ? "" : "is-muted", variant.variantId === highlightId ? "is-highlight" : ""].join(" ")}
                  >
                    <td data-label="Color">
                      <span className="color-cell">
                        <span className="swatch" style={{ background: variant.colorHex ?? "var(--ink-faint)" }} aria-hidden="true" />
                        <span className="clip">{variant.color}</span>
                      </span>
                    </td>
                    <td data-label="Talla"><span className="size-chip">{variant.size}</span></td>
                    <td data-label="SKU"><code className="sku">{variant.sku}</code></td>
                    <td data-label="Código de barras" className="barcode-cell">
                      <ActionForm
                        action={setVariantBarcodeAction}
                        submitLabel="Guardar"
                        pendingLabel="…"
                        className="barcode-form"
                        submitClassName="btn btn--small"
                      >
                        <input type="hidden" name="id" value={variant.variantId} />
                        <BarcodeField defaultValue={variant.barcode} sku={variant.sku} />
                      </ActionForm>
                    </td>
                    <td data-label="Stock" className="num">
                      <span className={`badge badge--${state}`}>{variant.stock} · {STOCK_LABEL[state]}</span>
                    </td>
                    <td data-label="Estado">
                      <ActiveToggle entity="variant" id={variant.variantId} active={variant.active} subject={variant.sku} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
