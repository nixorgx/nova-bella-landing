"use client";

import { useState } from "react";
import { formatBs } from "@/lib/money";
import {
  PAYMENT_LABEL,
  PAYMENT_METHODS,
  cashChange,
  methodTotal,
  type EffectivePayment,
  type PaymentMethod,
  type PaymentRow,
  type Reconciliation,
} from "../payments";

interface Props {
  readonly rows: readonly PaymentRow[];
  readonly payments: readonly EffectivePayment[];
  readonly reconciliation: Reconciliation;
  readonly total: string;
  readonly onAmount: (id: string, value: string) => void;
  readonly onMethod: (id: string, method: PaymentMethod) => void;
  readonly onFill: (id: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
}

const STATUS_TEXT = {
  short: (r: Reconciliation) => `Falta cobrar ${formatBs(r.remaining)}`,
  exact: () => "Pagos completos",
  over: (r: Reconciliation) => `Sobran ${formatBs(r.remaining.replace("-", ""))}`,
} as const;

/** Mixed payments: any number of rows, with the amount still missing always in sight. */
export function PaymentSection({ rows, payments, reconciliation, total, onAmount, onMethod, onFill, onAdd, onRemove }: Props) {
  const [received, setReceived] = useState("");
  const cashAmount = methodTotal(payments, "efectivo");
  const hasCash = cashAmount !== "0.00";
  const change = hasCash ? cashChange(received, cashAmount) : null;
  const empty = total === "0.00";

  return (
    <div className="stack">
      <ul className="pay-rows" aria-label="Pagos">
        {rows.map((row, index) => {
          const effective = payments[index];
          return (
            <li key={row.id} className="pay-row">
              <select
                className="field__control"
                aria-label={`Método del pago ${index + 1}`}
                value={row.method}
                onChange={(event) => onMethod(row.id, event.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>{PAYMENT_LABEL[method]}</option>
                ))}
              </select>
              <input
                className="field__control num"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Monto del pago ${index + 1} (${PAYMENT_LABEL[row.method]})`}
                value={row.touched ? row.amountInput : effective?.amount ?? ""}
                onChange={(event) => onAmount(row.id, event.target.value)}
                onFocus={(event) => event.target.select()}
              />
              <span className="pay-row__tools">
                <button type="button" className="btn btn--small" onClick={() => onFill(row.id)} aria-label={`Completar el pago ${index + 1} con lo que falta`} title="Completar con lo que falta" disabled={empty}>
                  ⤓
                </button>
                {rows.length > 1 ? (
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => onRemove(row.id)} aria-label={`Quitar el pago ${index + 1}`}>
                    ✕
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn--small" onClick={onAdd} disabled={rows.length >= 8}>
        + Agregar otro pago
      </button>
      <p className={`pay-status pay-status--${empty ? "idle" : reconciliation.status}`} role="status" aria-live="polite">
        <span>{empty ? "Agregue productos para cobrar" : STATUS_TEXT[reconciliation.status](reconciliation)}</span>
        {empty ? null : <span>{formatBs(reconciliation.paid)} / {formatBs(total)}</span>}
      </p>
      {hasCash ? (
        <div className="change-box">
          <div className="field">
            <label className="field__label" htmlFor="cash-received">Efectivo recibido</label>
            <input id="cash-received" className="field__control num" inputMode="decimal" autoComplete="off" placeholder={formatBs(cashAmount)} value={received} onChange={(event) => setReceived(event.target.value)} />
          </div>
          <div aria-live="polite">
            <span className="field__hint">Cambio</span>
            <br />
            <output htmlFor="cash-received">{change === null ? "—" : formatBs(change)}</output>
          </div>
        </div>
      ) : null}
    </div>
  );
}
