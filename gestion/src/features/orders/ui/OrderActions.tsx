"use client";

import { useActionState, useCallback, useMemo, useRef, useState, useTransition } from "react";
import { IDLE_FORM, type FormState } from "@/lib/form";
import { adminActions, sellerActions, type OrderShape } from "@/features/store/order-state";
import { cancelOrderAdminAction, confirmOrderAction, rejectProofAction, setOrderStatusAction } from "../actions";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

/** Single-button server action form. The button disables while pending: a double click cannot send twice. */
function OneClick({ action, orderId, label, pendingLabel, extra, className = "btn btn--primary", confirmText }: {
  action: Action; orderId: string; label: string; pendingLabel: string; extra?: React.ReactNode; className?: string; confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM);
  const [, startTransition] = useTransition();
  return (
    <form
      className="oform"
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <input type="hidden" name="orderId" value={orderId} />
      {extra}
      <button className={className} type="submit" disabled={pending}>{pending ? pendingLabel : label}</button>
      {state.message ? <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
    </form>
  );
}

function WithReason({ action, orderId, label, pendingLabel, prompt, className }: { action: Action; orderId: string; label: string; pendingLabel: string; prompt: string; className?: string }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <details className="oreason">
      <summary className={`btn btn--small ${className ?? ""}`}>{label}</summary>
      <form
        ref={formRef}
        className="oform"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        <input type="hidden" name="orderId" value={orderId} />
        <div className="field">
          <label className="field__label" htmlFor={`reason-${label}-${orderId}`}>{prompt}</label>
          <input id={`reason-${label}-${orderId}`} className="field__control" name="reason" required minLength={5} maxLength={300} autoComplete="off" />
        </div>
        <button className="btn btn--danger" type="submit" disabled={pending}>{pending ? pendingLabel : `Confirmar: ${label.toLowerCase()}`}</button>
        {state.message ? <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
      </form>
    </details>
  );
}

const hiddenStatus = (status: string) => <input type="hidden" name="status" value={status} />;

function DeliverForm({ orderId, cod, action }: { orderId: string; cod: boolean; action: Action }) {
  const [state, formAction, pending] = useActionState(action, IDLE_FORM);
  const [, startTransition] = useTransition();
  return (
    <form className="oform" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); startTransition(() => formAction(data)); }}>
      <input type="hidden" name="orderId" value={orderId} />
      {hiddenStatus("entregado")}
      {cod ? (
        <div className="field">
          <label className="field__label" htmlFor={`collected-${orderId}`}>Cobrado al entregar</label>
          <select id={`collected-${orderId}`} className="field__control" name="collected" defaultValue="efectivo">
            <option value="efectivo">Efectivo</option>
            <option value="qr">QR</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
          </select>
        </div>
      ) : null}
      <button className="btn btn--primary" type="submit" disabled={pending}>{pending ? "Guardando…" : "Marcar como entregado"}</button>
      {state.message ? <p className={`notice ${state.ok ? "notice--ok" : "notice--error"}`} role={state.ok ? "status" : "alert"}>{state.message}</p> : null}
    </form>
  );
}

export function OrderActions({ orderId, order, role }: { orderId: string; order: OrderShape; role: "superadmin" | "seller" }) {
  const actions = role === "superadmin" ? adminActions(order) : sellerActions(order);
  const [flash, setFlash] = useState<string | null>(null);
  // The success message lives here, not in the button forms: those unmount as soon as the new status changes the
  // action list (the action's own revalidation re-renders the page in the same commit), so they cannot show it.
  const wrap = useCallback(
    (action: Action): Action =>
      async (previous, formData) => {
        const result = await action(previous, formData);
        if (result.ok) setFlash(result.message ?? "Listo.");
        return result;
      },
    [],
  );
  const confirm = useMemo(() => wrap(confirmOrderAction), [wrap]);
  const reject = useMemo(() => wrap(rejectProofAction), [wrap]);
  const status = useMemo(() => wrap(setOrderStatusAction), [wrap]);
  const cancel = useMemo(() => wrap(cancelOrderAdminAction), [wrap]);
  if (actions.length === 0) {
    return (
      <div className="oactions">
        {flash ? <p className="notice notice--ok" role="status">{flash}</p> : null}
        <p className="is-muted">No hay más acciones para este estado.</p>
      </div>
    );
  }
  return (
    <div className="oactions">
      {flash ? <p className="notice notice--ok" role="status">{flash}</p> : null}
      {actions.includes("confirm") ? (
        <OneClick
          action={confirm}
          orderId={orderId}
          label={order.paymentMethod === "qr" ? "Confirmar pago y crear venta" : "Confirmar pedido y crear venta"}
          pendingLabel="Confirmando…"
        />
      ) : null}
      {actions.includes("reject_proof") ? <WithReason action={reject} orderId={orderId} label="Rechazar comprobante" pendingLabel="Rechazando…" prompt="Motivo (lo verá el cliente)" /> : null}
      {actions.includes("ship") ? <OneClick action={status} orderId={orderId} label="Marcar en camino" pendingLabel="Guardando…" extra={hiddenStatus("en_camino")} /> : null}
      {actions.includes("ready") ? <OneClick action={status} orderId={orderId} label="Marcar listo para recoger" pendingLabel="Guardando…" extra={hiddenStatus("listo_para_recoger")} /> : null}
      {actions.includes("deliver") ? <DeliverForm action={status} orderId={orderId} cod={order.paymentMethod === "contra_entrega"} /> : null}
      {actions.includes("cancel") ? <WithReason action={cancel} orderId={orderId} label="Cancelar pedido" pendingLabel="Cancelando…" prompt="Motivo de la cancelación" className="btn--danger" /> : null}
    </div>
  );
}
