"use client";

import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { IDLE_FORM } from "@/lib/form";
import { formatBs } from "@/lib/money";
import { closeCashAction } from "../actions";
import { cashClosing } from "../cash-math";

interface Props {
  readonly sessionId: string;
  readonly openingAmount: string;
  readonly cashSales: string;
  /** Cash collected minus refunded by exchanges in this session. */
  readonly cashExchangeNet?: string;
}

const STATUS_TEXT = {
  pending: "Cuente el efectivo del cajón e ingréselo para ver la diferencia.",
  balanced: "La caja cuadra.",
  short: "Falta dinero en la caja.",
  over: "Sobra dinero en la caja.",
} as const;

/** Closing form: shows expected vs counted and the difference live, before confirming. */
export function CloseCashForm({ sessionId, openingAmount, cashSales, cashExchangeNet = "0.00" }: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState(closeCashAction, IDLE_FORM);
  const [counted, setCounted] = useState("");
  const result = useMemo(() => cashClosing({ openingAmount, cashSales, cashExchangeNet, counted }), [openingAmount, cashSales, cashExchangeNet, counted]);

  if (state.ok) {
    return (
      <div className="stack">
        <p className="notice notice--ok" role="status">{state.message}</p>
        <button type="button" className="btn btn--primary" onClick={() => router.refresh()}>
          Continuar
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="stack" noValidate>
      <input type="hidden" name="sessionId" value={sessionId} />
      {state.message ? (
        <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor="counted">Efectivo contado (Bs)</label>
        <input id="counted" name="counted" className="field__control num" inputMode="decimal" autoComplete="off" placeholder={formatBs(result.expected)} value={counted} onChange={(event) => setCounted(event.target.value)} required />
      </div>
      <dl className="money-list" aria-live="polite">
        <div><dt>Esperado en caja</dt><dd>{formatBs(result.expected)}</dd></div>
        <div className="is-total">
          <dt>Diferencia</dt>
          <dd className={`diff diff--${result.status}`}>{result.difference === null ? "—" : formatBs(result.difference)}</dd>
        </div>
      </dl>
      <p className="field__hint">{STATUS_TEXT[result.status]}</p>
      <button type="submit" className="btn btn--primary" disabled={pending || result.status === "pending"}>
        {pending ? "Cerrando…" : "Cerrar caja"}
      </button>
    </form>
  );
}
