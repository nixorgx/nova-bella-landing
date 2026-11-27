"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import type { VariantHit } from "@/features/catalog/types";
import { formatRateInput } from "@/lib/number-input";
import { createBatchAction } from "../actions";
import { previewDraft } from "../form-math";
import type { ExchangeRate } from "../rates";
import { BatchItemsPanel } from "./BatchItemsPanel";
import { BatchPreviewPanel } from "./BatchPreviewPanel";
import { addItem, dropItem, patchItem, type BatchItemState } from "./draft-state";

interface Props {
  readonly branches: readonly { id: string; name: string }[];
  readonly suppliers: readonly string[];
  readonly latestRate: ExchangeRate | null;
  readonly today: string;
}

const shortDate = new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export function PurchaseForm({ branches, suppliers, latestRate, today }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [batchDate, setBatchDate] = useState(today);
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [rate70, setRate70] = useState("");
  const [rate30, setRate30] = useState("");
  const [split, setSplit] = useState("70");
  const [freight, setFreight] = useState("0");
  const [items, setItems] = useState<readonly BatchItemState[]>([]);

  const preview = useMemo(
    () => previewDraft({ rate70Input: rate70, rate30Input: rate30, splitInput: split, freightInput: freight, items }),
    [rate70, rate30, split, freight, items],
  );

  const useLatest = useCallback(() => {
    if (!latestRate) return;
    setRate70(formatRateInput(latestRate.officialRate));
    setRate30(formatRateInput(latestRate.parallelRate));
  }, [latestRate]);

  const onBulk = useCallback((rows: readonly { hit: VariantHit; qtyInput: string; costInput: string }[]) => {
    setItems((current) =>
      rows.reduce<readonly BatchItemState[]>((acc, row) => {
        const added = addItem(acc, row.hit);
        return patchItem(added, row.hit.variantId, { qtyInput: row.qtyInput, costInput: row.costInput });
      }, current),
    );
  }, []);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await createBatchAction({
        branchId,
        batchDate,
        supplier,
        notes,
        rate70Input: rate70,
        rate30Input: rate30,
        splitInput: split,
        freightInput: freight,
        items: items.map(({ variantId, qtyInput, costInput }) => ({ variantId, qtyInput, costInput })),
      });
      if (result.ok) router.push(`/compras/${result.batchId}?nuevo=1`);
      else setError(result.message);
    });
  }

  const canConfirm = preview.ready && branchId !== "" && !pending;
  return (
    <div className="batch-layout">
      <div className="stack">
        <section className="panel panel--cost" aria-labelledby="meta-title">
          <div className="panel__head">
            <h2 id="meta-title">Datos del lote</h2>
            <span className="cost-tag">Costo</span>
          </div>
          <div className="panel__body stack">
            <div className="form-row form-row--4">
              <div className="field">
                <label className="field__label" htmlFor="batch-date">Fecha</label>
                <input id="batch-date" type="date" className="field__control" value={batchDate} max={today} onChange={(e) => setBatchDate(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="batch-branch">Sucursal</label>
                <select id="batch-branch" className="field__control" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="batch-supplier">Proveedor</label>
                <input id="batch-supplier" className="field__control" list="supplier-list" maxLength={80} autoComplete="off" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                <datalist id="supplier-list">
                  {suppliers.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="batch-freight">Flete total (Bs)</label>
                <input id="batch-freight" className="field__control num" inputMode="decimal" autoComplete="off" value={freight} aria-invalid={preview.errors.freight ? true : undefined} onChange={(e) => setFreight(e.target.value)} />
                <p className="field__hint">Se reparte por unidad. Opcional.</p>
              </div>
            </div>
            <div className="form-row form-row--4">
              <RateField id="rate70" label="TC para la parte 70%" value={rate70} error={preview.errors.rate70} onChange={setRate70} />
              <RateField id="rate30" label="TC para la parte 30%" value={rate30} error={preview.errors.rate30} onChange={setRate30} />
              <div className="field">
                <label className="field__label" htmlFor="batch-split">% a TC 70 (resto va al TC 30)</label>
                <input id="batch-split" className="field__control num" inputMode="decimal" autoComplete="off" value={split} aria-invalid={preview.errors.split ? true : undefined} onChange={(e) => setSplit(e.target.value)} />
                {preview.errors.split ? <p className="field__error" role="alert">{preview.errors.split}</p> : null}
              </div>
              <div className="field">
                <label className="field__label" htmlFor="batch-notes">Notas</label>
                <input id="batch-notes" className="field__control" maxLength={300} autoComplete="off" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
            <div className="rate-actions">
              <button type="button" className="btn btn--small" onClick={useLatest} disabled={!latestRate}>
                Usar último TC
              </button>
              <span className="rate-hint">
                {latestRate
                  ? `Último registrado (${shortDate.format(new Date(`${latestRate.rateDate}T00:00:00Z`))}): oficial ${formatRateInput(latestRate.officialRate)} · paralelo ${formatRateInput(latestRate.parallelRate)}`
                  : "Aún no hay tipos de cambio registrados."}
              </span>
            </div>
          </div>
        </section>

        <BatchItemsPanel
          branchId={branchId}
          items={items}
          rows={preview.rows}
          onPick={(hit) => setItems((current) => addItem(current, hit))}
          onPatch={(id, patch) => setItems((current) => patchItem(current, id, patch))}
          onRemove={(id) => setItems((current) => dropItem(current, id))}
          onBulk={onBulk}
        />
      </div>

      <aside className="batch-layout__side" aria-label="Resumen del lote">
        <BatchPreviewPanel preview={preview} />
        {error ? (
          <p className="notice notice--error" role="alert">{error}</p>
        ) : null}
        <button type="button" className="btn btn--primary btn--block" disabled={!canConfirm} onClick={confirm}>
          {pending ? "Registrando lote…" : "Confirmar ingreso de mercadería"}
        </button>
        <p className="field__hint">
          Al confirmar se guarda el lote, sube el stock y se actualiza el costo de cada variante, todo en una sola operación.
        </p>
      </aside>
    </div>
  );
}

function RateField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const shown = value.trim() === "" ? undefined : error;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input id={id} className="field__control num" inputMode="decimal" autoComplete="off" placeholder="6,96" value={value} aria-invalid={shown ? true : undefined} aria-describedby={shown ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
      {shown ? <p className="field__error" id={`${id}-error`} role="alert">{shown}</p> : null}
    </div>
  );
}
