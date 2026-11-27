"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useTransition } from "react";
import { IDLE_FORM } from "@/lib/form";
import { cancelOrderAction } from "../actions";
import { useCart } from "../cart/useCart";

/** After a fresh checkout the cart is spent: empty it once and drop `?nuevo=1` from the address bar. */
export function ClearCartOnNew({ active }: { active: boolean }) {
  const { clear } = useCart();
  useEffect(() => {
    if (!active) return;
    clear();
    try {
      // a finished checkout must not hand its idempotency key to the NEXT purchase with the same cart
      window.sessionStorage.removeItem("nb-checkout-key-v1");
    } catch {
      // storage blocked: nothing to clear
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [active, clear]);
  return null;
}

/** Keeps the status page fresh while the order is still moving (pauses when the tab is hidden). */
export function AutoRefresh({ everySeconds = 45 }: { everySeconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everySeconds * 1000);
    return () => clearInterval(timer);
  }, [router, everySeconds]);
  return null;
}

export function CancelOrderForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(cancelOrderAction, IDLE_FORM);
  const [, startTransition] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form
      className="sinline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!window.confirm("¿Cancelar este pedido? Esta acción no se puede deshacer.")) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <input type="hidden" name="token" value={token} />
      <button className="btn btn--quiet btn--danger btn--small" type="submit" disabled={pending}>
        {pending ? "Cancelando…" : "Cancelar pedido"}
      </button>
      {state.message && !state.ok ? <p className="field__error" role="alert">{state.message}</p> : null}
    </form>
  );
}
