"use client";

import { useActionState, useId, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { IDLE_FORM } from "@/lib/form";
import { formatBs } from "@/lib/money";
import { applyPriceAction } from "../actions";

interface Props {
  readonly modelId: string;
  readonly model: string;
  readonly currentPrice: string;
  readonly suggestedPrice: string;
}

/**
 * Two steps on purpose: the suggestion is only applied after the superadmin reads the
 * old and new price and ticks the confirmation. Nothing here runs automatically.
 */
export function ApplyPrice({ modelId, model, currentPrice, suggestedPrice }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [state, action, pending] = useActionState(applyPriceAction, IDLE_FORM);
  const checkId = useId();

  return (
    <div className="price-card__apply">
      <button type="button" className="btn btn--small" onClick={() => { setConfirmed(false); setOpen(true); }}>
        Aplicar {formatBs(suggestedPrice)}…
      </button>
      {state.message ? (
        <span className={state.ok ? "rate-hint" : "field__error"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </span>
      ) : null}
      <Modal open={open && !state.ok} onClose={() => setOpen(false)} title="Cambiar precio de venta">
        <form action={action} className="stack">
          <input type="hidden" name="modelId" value={modelId} />
          <input type="hidden" name="price" value={suggestedPrice} />
          <input type="hidden" name="confirm" value={confirmed ? "yes" : "no"} />
          <p>
            Modelo <strong>{model}</strong>: el precio base pasará de <strong>{formatBs(currentPrice)}</strong> a{" "}
            <strong>{formatBs(suggestedPrice)}</strong>. Afecta a todas sus variantes y a las ventas desde ahora; las ventas ya hechas no cambian.
          </p>
          <label className="check" htmlFor={checkId}>
            <input id={checkId} type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>Confirmo el cambio de precio</span>
          </label>
          {state.message && !state.ok ? <p className="notice notice--error" role="alert">{state.message}</p> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={!confirmed || pending}>
              {pending ? "Aplicando…" : "Aplicar nuevo precio"}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
