"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { voidSaleAction } from "../void-action";
import { MAX_VOID_REASON, MIN_VOID_REASON } from "../void-schema";

interface Props {
  readonly saleId: string;
  readonly exchangeCount: number;
}

/** Superadmin only (the page does not even render it for sellers). Needs a reason; sales with exchanges explain why not. */
export function VoidSalePanel({ saleId, exchangeCount }: Props) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (exchangeCount > 0) {
    return (
      <section className="panel panel--void" aria-labelledby={`${uid}-t`}>
        <div className="panel__head"><h2 id={`${uid}-t`}>Anular venta</h2><span className="badge badge--low">No disponible</span></div>
        <div className="panel__body stack">
          <p><strong>Esta venta tiene {exchangeCount} {exchangeCount === 1 ? "cambio registrado" : "cambios registrados"} y no se puede anular.</strong></p>
          <p>
            Los cambios ya movieron el stock (entró un par y salió otro) y la diferencia pasó por la caja. Anular la venta completa
            volvería a sumar pares que ya no están en esa venta, y el inventario quedaría mal.
          </p>
          <p className="field__hint">
            Camino recomendado: deje la venta como está y registre un nuevo cambio por el mismo modelo en la talla correcta. Si hay que
            devolver dinero al cliente, el superadmin puede fijar la diferencia a mano en ese cambio (hasta lo que se pagó por el par).
          </p>
        </div>
      </section>
    );
  }

  const valid = reason.trim().length >= MIN_VOID_REASON && understood;

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await voidSaleAction({ saleId, reason });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="panel panel--void" aria-labelledby={`${uid}-t`}>
      <div className="panel__head">
        <h2 id={`${uid}-t`}>Anular venta</h2>
        <button type="button" className="btn btn--small btn--danger" aria-expanded={open} aria-controls={`${uid}-body`} onClick={() => setOpen((v) => !v)}>
          {open ? "No anular" : "Anular esta venta"}
        </button>
      </div>
      <div id={`${uid}-body`} className="panel__body stack" hidden={!open}>
        <p className="field__hint">La venta no se borra: queda en el historial como anulada, los pares vuelven al stock y el monto deja de sumar en cajas y reportes.</p>
        <div className="field">
          <label className="field__label" htmlFor={`${uid}-reason`}>Motivo de la anulación</label>
          <textarea
            id={`${uid}-reason`}
            className="field__control field__control--area"
            rows={3}
            maxLength={MAX_VOID_REASON}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej. Se cobró dos veces / el cliente devolvió todo el mismo día"
            aria-describedby={`${uid}-hint`}
          />
          <p id={`${uid}-hint`} className="field__hint">Obligatorio, mínimo {MIN_VOID_REASON} caracteres. Queda guardado con tu nombre y la hora.</p>
        </div>
        <label className="check">
          <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          Entiendo que esta acción no se puede deshacer
        </label>
        {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        <div>
          <button type="button" className="btn btn--danger" disabled={!valid || pending} onClick={submit}>
            {pending ? "Anulando…" : "Confirmar anulación"}
          </button>
        </div>
      </div>
    </section>
  );
}
