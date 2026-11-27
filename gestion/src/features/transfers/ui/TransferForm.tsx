"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { VariantSearch } from "@/components/search/VariantSearch";
import { createTransferAction } from "../actions";
import { addLine, dropLine, lineError, patchQty, summarize, type TransferLine } from "../draft";

interface Props {
  readonly branches: readonly { id: string; name: string }[];
}

export function TransferForm({ branches }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState(branches[0]?.id ?? "");
  const [toId, setToId] = useState(branches[1]?.id ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<readonly TransferLine[]>([]);
  const summary = useMemo(() => summarize(lines), [lines]);
  const sameBranch = fromId !== "" && fromId === toId;
  const fromName = branches.find((b) => b.id === fromId)?.name ?? "";
  const toName = branches.find((b) => b.id === toId)?.name ?? "";
  const canConfirm = summary.ready && fromId !== "" && toId !== "" && !sameBranch && !pending;

  function changeFrom(id: string) {
    setFromId(id);
    // Stock shown on each line belongs to the origin branch, so a new origin starts a new list.
    setLines([]);
    setError(null);
    if (id === toId) setToId(branches.find((b) => b.id !== id)?.id ?? "");
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await createTransferAction({
        fromBranchId: fromId,
        toBranchId: toId,
        note,
        items: lines.map(({ variantId, qtyInput }) => ({ variantId, qtyInput })),
      });
      if (result.ok) router.push(`/sucursales/transferencias/${result.transferId}?nueva=1`);
      else setError(result.message);
    });
  }

  if (branches.length < 2) {
    return (
      <p className="notice notice--warn" role="status">
        Para transferir stock hacen falta al menos dos sucursales activas. Active la otra sucursal en Sucursales.
      </p>
    );
  }

  return (
    <div className="batch-layout">
      <div className="stack">
        <section className="panel" aria-labelledby="route-title">
          <div className="panel__head"><h2 id="route-title">De dónde a dónde</h2></div>
          <div className="panel__body stack">
            <div className="form-row">
              <div className="field">
                <label className="field__label" htmlFor="tr-from">Sucursal de origen</label>
                <select id="tr-from" className="field__control" value={fromId} onChange={(event) => changeFrom(event.target.value)}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor="tr-to">Sucursal de destino</label>
                <select id="tr-to" className="field__control" value={toId} aria-invalid={sameBranch ? true : undefined} onChange={(event) => setToId(event.target.value)}>
                  {branches.filter((b) => b.id !== fromId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="tr-note">Nota (opcional)</label>
              <input id="tr-note" className="field__control" maxLength={300} autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="tr-items-title">
          <div className="panel__head">
            <h2 id="tr-items-title">Productos a transferir</h2>
            <span className="eyebrow">{lines.length} {lines.length === 1 ? "producto" : "productos"}</span>
          </div>
          <div className="panel__body stack">
            <VariantSearch
              scanner
              autoFocus
              branchId={fromId}
              label="Escanear o buscar producto"
              placeholder={`Escanee o busque en ${fromName}…`}
              onSelect={(hit) => setLines((current) => addLine(current, hit))}
            />
            {lines.length === 0 ? (
              <p className="items-empty">Escanee o busque los productos que salen de {fromName}. La lista muestra cuántos pares hay allí.</p>
            ) : (
              <ul className="batch-items" aria-label="Productos agregados">
                {lines.map((line) => (
                  <LineRow
                    key={line.variantId}
                    line={line}
                    onQty={(value) => setLines((current) => patchQty(current, line.variantId, value))}
                    onRemove={() => setLines((current) => dropLine(current, line.variantId))}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <aside className="batch-layout__side" aria-label="Resumen de la transferencia">
        <section className="panel">
          <div className="panel__head"><h2>Resumen</h2></div>
          <dl className="panel__body transfer-summary">
            <div><dt>Sale de</dt><dd>{fromName}</dd></div>
            <div><dt>Llega a</dt><dd>{toName || "—"}</dd></div>
            <div><dt>Productos</dt><dd className="num">{summary.products}</dd></div>
            <div><dt>Pares</dt><dd className="num">{summary.units}</dd></div>
          </dl>
        </section>
        {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        <button type="button" className="btn btn--primary btn--block" disabled={!canConfirm} onClick={confirm}>
          {pending ? "Transfiriendo…" : "Confirmar transferencia"}
        </button>
        <p className="field__hint">Al confirmar, el stock sale de {fromName} y entra a {toName || "la otra sucursal"} en una sola operación.</p>
      </aside>
    </div>
  );
}

function LineRow({ line, onQty, onRemove }: { line: TransferLine; onQty: (value: string) => void; onRemove: () => void }) {
  const label = `${line.model} ${line.color} talla ${line.size}`;
  const problem = lineError(line);
  const errorId = `qty-error-${line.variantId}`;
  return (
    <li className="batch-item batch-item--transfer">
      <div className="batch-item__name">
        <strong>{line.model}</strong>
        <span className="color-cell">
          <span className="swatch" style={{ background: line.colorHex ?? "var(--ink-faint)" }} aria-hidden="true" />
          <span className="clip">{line.color} · Talla {line.size}</span>
        </span>
        <code className="sku">{line.sku}</code>
        <span className="field__hint">Disponible en el origen: {line.available}</span>
      </div>
      <div className="batch-item__fields">
        <div className="field">
          <label className="field__label" htmlFor={`tq-${line.variantId}`}>Cantidad</label>
          <input
            id={`tq-${line.variantId}`}
            className="field__control num"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Cantidad de ${label}`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            value={line.qtyInput}
            onChange={(event) => onQty(event.target.value)}
          />
        </div>
      </div>
      <button type="button" className="btn btn--small btn--quiet" onClick={onRemove} aria-label={`Quitar ${label}`}>Quitar</button>
      {problem ? <p id={errorId} className="field__error batch-item__row-error" role="alert">{problem}</p> : null}
    </li>
  );
}
