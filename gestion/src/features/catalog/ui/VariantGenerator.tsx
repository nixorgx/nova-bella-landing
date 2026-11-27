"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ActionForm } from "@/components/form/ActionForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { generateVariantsAction } from "../model-actions";
import type { ColorOption, SizeOption } from "../queries";
import { MAX_COMBINATIONS, planVariantMatrix, type VariantPair } from "../variant-matrix";

interface Props {
  readonly modelId: string;
  readonly colors: readonly ColorOption[];
  readonly sizes: readonly SizeOption[];
  readonly existing: readonly VariantPair[];
}

function toggled(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function VariantGenerator({ modelId, colors, sizes, existing }: Props) {
  const [colorIds, setColorIds] = useState<readonly string[]>([]);
  const [sizeIds, setSizeIds] = useState<readonly string[]>([]);
  const reset = useCallback(() => {
    setColorIds([]);
    setSizeIds([]);
  }, []);

  const plan = useMemo(() => planVariantMatrix({ colorIds, sizeIds, existing }), [colorIds, sizeIds, existing]);
  const existingKeys = useMemo(() => new Set(existing.map((p) => `${p.colorId}:${p.sizeId}`)), [existing]);

  if (colors.length === 0 || sizes.length === 0) {
    return (
      <EmptyState
        title="Faltan colores o tallas"
        action={
          <Link className="btn btn--small" href="/catalogo/atributos">
            Ir a colores y tallas
          </Link>
        }
      >
        Para generar variantes necesita al menos un color y una talla activos.
      </EmptyState>
    );
  }

  const tooMany = plan.total > MAX_COMBINATIONS;
  const label = plan.toCreate.length === 1 ? "Crear 1 variante" : `Crear ${plan.toCreate.length} variantes`;

  return (
    <ActionForm
      action={generateVariantsAction}
      submitLabel={plan.toCreate.length > 0 ? label : "Marque colores y tallas"}
      pendingLabel="Creando variantes…"
      submitDisabled={plan.toCreate.length === 0 || tooMany}
      onSuccess={reset}
    >
      <input type="hidden" name="modelId" value={modelId} />
      {colorIds.map((id) => (
        <input key={id} type="hidden" name="colorIds" value={id} />
      ))}
      {sizeIds.map((id) => (
        <input key={id} type="hidden" name="sizeIds" value={id} />
      ))}

      <div className="matrix-tools">
        <button type="button" className="btn btn--small btn--quiet" onClick={() => setColorIds(colors.map((c) => c.id))}>
          Todos los colores
        </button>
        <button type="button" className="btn btn--small btn--quiet" onClick={() => setSizeIds(sizes.map((s) => s.id))}>
          Todas las tallas
        </button>
        <button type="button" className="btn btn--small btn--quiet" onClick={reset} disabled={!colorIds.length && !sizeIds.length}>
          Limpiar
        </button>
      </div>

      <div className="matrix-wrap" role="group" aria-label="Matriz de colores por tallas">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col" className="matrix__corner">
                Color ↓ · Talla →
              </th>
              {sizes.map((size) => (
                <th key={size.id} scope="col">
                  <label className="matrix__pick">
                    <input
                      type="checkbox"
                      checked={sizeIds.includes(size.id)}
                      onChange={() => setSizeIds((current) => toggled(current, size.id))}
                    />
                    <span className="size-chip">{size.label}</span>
                    <span className="sr-only">Talla {size.label}</span>
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => {
              const rowOn = colorIds.includes(color.id);
              return (
                <tr key={color.id} className={rowOn ? "is-on" : undefined}>
                  <th scope="row">
                    <label className="matrix__pick matrix__pick--row">
                      <input type="checkbox" checked={rowOn} onChange={() => setColorIds((current) => toggled(current, color.id))} />
                      <span className="swatch" style={{ background: color.hex }} aria-hidden="true" />
                      <span className="clip">{color.name}</span>
                      <span className="sr-only">Color {color.name}</span>
                    </label>
                  </th>
                  {sizes.map((size) => {
                    const exists = existingKeys.has(`${color.id}:${size.id}`);
                    const picked = rowOn && sizeIds.includes(size.id);
                    const state = exists ? "exists" : picked ? "new" : "none";
                    return (
                      <td key={size.id} className={`matrix__cell matrix__cell--${state}`}>
                        <span className="sr-only">
                          {color.name} talla {size.label}: {exists ? "ya existe" : picked ? "se creará" : "sin variante"}
                        </span>
                        <span aria-hidden="true">{exists ? "✓" : picked ? "+" : ""}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="matrix-preview" role="status" aria-live="polite">
        {plan.total === 0 ? (
          "Marque colores y tallas para ver cuántas variantes se crearán."
        ) : (
          <>
            <strong>{plan.toCreate.length}</strong> {plan.toCreate.length === 1 ? "variante nueva" : "variantes nuevas"}
            {plan.toSkip.length > 0 ? ` · ${plan.toSkip.length} ya existen y se omitirán` : ""}
            {tooMany ? ` · máximo ${MAX_COMBINATIONS} por vez` : ""}
          </>
        )}
      </p>
    </ActionForm>
  );
}
