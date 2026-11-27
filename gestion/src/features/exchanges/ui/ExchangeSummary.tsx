"use client";

import { formatBs } from "@/lib/money";
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/features/sales/payments";
import { EXCHANGE_REASON_LABEL, EXCHANGE_REASONS, type ExchangeReason } from "../reasons";
import type { ExchangePreview } from "../preview";
import type { ReturnableLine } from "../queries";
import { setOverride, type Draft } from "./exchange-state";

interface Props {
  readonly preview: ExchangePreview | null;
  readonly pending: boolean;
  readonly draft: Draft;
  readonly onDraft: (next: Draft) => void;
  readonly lines: readonly ReturnableLine[];
  readonly isAdmin: boolean;
  readonly cashOpen: boolean;
  readonly method: PaymentMethod | "";
  readonly onMethod: (method: PaymentMethod | "") => void;
  readonly reason: ExchangeReason | "";
  readonly onReason: (reason: ExchangeReason | "") => void;
  readonly note: string;
  readonly onNote: (note: string) => void;
}

const DIRECTION_TEXT = { cobrar: "Cobrar al cliente", devolver: "Devolver al cliente", ninguna: "Cambio parejo" } as const;

/** Step 3: the difference computed by the server, how it is settled and why the exchange happens. */
export function ExchangeSummary(props: Props) {
  const { preview, pending, draft, onDraft, lines, isAdmin, cashOpen, method, onMethod, reason, onReason, note, onNote } = props;
  const nameOf = (variantId: string) => lines.find((l) => l.variantId === variantId);
  return (
    <div className="xsummary" aria-live="polite" aria-busy={pending}>
      <h3 className="xsummary__title">Diferencia de precio <span className="eyebrow">la calcula el sistema</span></h3>
      {!preview ? (
        <p className="is-muted">Elija el producto nuevo de cada línea para ver la diferencia.</p>
      ) : (
        <>
          <ul className="xdiffs">
            {preview.lines.map((line) => {
              const source = nameOf(line.returnedVariantId);
              return (
                <li key={`${line.returnedVariantId}-${line.newVariantId}`}>
                  <span>
                    <strong className="clip-2">{line.qty} × {source?.model} T{source?.size} → {line.newLabel ?? "…"}</strong>
                    <small>
                      {line.paidUnit && line.newPrice ? `pagó ${formatBs(line.paidUnit)} · ahora ${formatBs(line.newPrice)}` : "sin precio"}
                    </small>
                  </span>
                  <strong className="num">{line.diff === null ? "—" : line.diff.startsWith("-") ? `− ${formatBs(line.diff.slice(1))}` : formatBs(line.diff)}</strong>
                </li>
              );
            })}
          </ul>
          <div className={`xnet xnet--${preview.direction}`}>
            <span>{DIRECTION_TEXT[preview.direction]}</span>
            <strong className="num">{preview.direction === "ninguna" ? "Bs 0,00" : formatBs(preview.amount)}</strong>
          </div>
        </>
      )}

      {isAdmin && preview ? (
        <details className="xoverride">
          <summary>Fijar la diferencia a mano (superadmin)</summary>
          <p className="field__hint">Dentro de los límites: no se devuelve más de lo pagado ni se cobra más que el precio de lista del producto nuevo.</p>
          {preview.lines.map((line) => (
            <div key={line.returnedVariantId} className="field">
              <label className="field__label" htmlFor={`o-${line.returnedVariantId}`}>Diferencia de {nameOf(line.returnedVariantId)?.model} T{nameOf(line.returnedVariantId)?.size} (Bs)</label>
              <input
                id={`o-${line.returnedVariantId}`}
                className="field__control num"
                inputMode="decimal"
                placeholder={line.diff ?? "0,00"}
                defaultValue={draft[line.returnedVariantId]?.override ?? ""}
                onBlur={(event) => onDraft(setOverride(draft, line.returnedVariantId, event.target.value))}
              />
            </div>
          ))}
        </details>
      ) : null}

      {preview?.needsMethod ? (
        <div className="field">
          <label className="field__label" htmlFor="x-method">{preview.direction === "devolver" ? "¿Cómo se devuelve el dinero?" : "¿Cómo paga la diferencia?"}</label>
          <select id="x-method" className="field__control" value={method} onChange={(event) => onMethod(event.target.value as PaymentMethod | "")}>
            <option value="">Elegir método…</option>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
          </select>
          {!cashOpen ? <p className="field__error" role="alert">No hay una caja abierta: ábrala en la pestaña Caja para cobrar o devolver la diferencia.</p> : null}
        </div>
      ) : null}

      <div className="xreason">
        <div className="field">
          <label className="field__label" htmlFor="x-reason">Motivo del cambio</label>
          <select id="x-reason" className="field__control" value={reason} onChange={(event) => onReason(event.target.value as ExchangeReason | "")}>
            <option value="">Elegir motivo…</option>
            {EXCHANGE_REASONS.map((r) => <option key={r} value={r}>{EXCHANGE_REASON_LABEL[r]}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="x-note">Nota (opcional)</label>
          <input id="x-note" className="field__control" maxLength={200} value={note} onChange={(event) => onNote(event.target.value)} placeholder="Ej. le quedaba apretado" />
        </div>
      </div>
    </div>
  );
}
