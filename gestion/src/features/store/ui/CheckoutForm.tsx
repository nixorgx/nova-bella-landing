"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { IDLE_FORM } from "@/lib/form";
import { addMoney, formatBs } from "@/lib/money";
import { createOrderAction } from "../actions";
import { cartSignature } from "../cart/cart-store";
import { useCart } from "../cart/useCart";
import { useCartDetails } from "../cart/useCartDetails";
import type { StoreInfo } from "../public-data";
import { PAYMENT_PROVIDERS } from "../providers/payment";
import { CartLineRow } from "./CartView";

const KEY_STORAGE = "nb-checkout-key-v1";

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** One idempotency key per cart content: a double click or a retry reuses it, a different cart gets a new one. */
function keyFor(signature: string): string {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY_STORAGE) ?? "null") as { signature: string; key: string } | null;
    if (saved && saved.signature === signature && /^[A-Za-z0-9_-]{22,64}$/.test(saved.key)) return saved.key;
    const key = newKey();
    window.sessionStorage.setItem(KEY_STORAGE, JSON.stringify({ signature, key }));
    return key;
  } catch {
    return newKey();
  }
}

type Fulfillment = "delivery" | "pickup";

export function CheckoutForm({ info }: { info: StoreInfo }) {
  const cart = useCart();
  const details = useCartDetails(cart.lines);
  const [state, formAction, pending] = useActionState(createOrderAction, IDLE_FORM);
  const [, startTransition] = useTransition();
  const signature = useMemo(() => cartSignature(cart.lines), [cart.lines]);
  const [key, setKey] = useState("");
  const [fulfillment, setFulfillment] = useState<Fulfillment>(info.zones.length > 0 ? "delivery" : "pickup");
  const [zoneId, setZoneId] = useState(info.zones[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState<"qr" | "contra_entrega">(info.has_qr ? "qr" : "contra_entrega");
  const [wantsInvoice, setWantsInvoice] = useState(false);

  useEffect(() => {
    // The key lives in sessionStorage, which only exists in the browser: set after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(signature ? keyFor(signature) : "");
  }, [signature]);

  const errors = state.fieldErrors ?? {};
  const values = state.values ?? {};
  const zone = info.zones.find((z) => z.id === zoneId);
  const fee = fulfillment === "delivery" ? String(zone?.fee ?? 0) : "0";
  const total = addMoney(details.subtotal, fee);
  const payments = PAYMENT_PROVIDERS.filter((p) => p.method !== "qr" || info.has_qr || Boolean(info.bank_instructions));

  if (cart.lines.length === 0) {
    return (
      <EmptyState title="Su carrito está vacío" action={<Link className="btn btn--primary" href="/tienda">Ver el catálogo</Link>}>
        Agregue un producto para hacer su pedido.
      </EmptyState>
    );
  }
  if (!info.open) {
    return (
      <p className="notice" role="status">
        La tienda no está recibiendo pedidos en este momento. <Link href="/tienda/carrito">Volver al carrito</Link>
      </p>
    );
  }

  const blocked = details.status !== "ready" || details.hasProblems || !key || pending;

  return (
    <form
      className="checkout"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <div className="checkout__main">
        {state.message ? (
          <p className="notice notice--error" role="alert">
            {state.message}
          </p>
        ) : null}

        <fieldset className="csec">
          <legend>
            <span className="csec__n">1</span> Sus datos
          </legend>
          <Field label="Nombre completo" name="name" autoComplete="name" defaultValue={values.name} error={errors.name} maxLength={80} required />
          <Field
            label="Celular (WhatsApp)"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            defaultValue={values.phone}
            error={errors.phone}
            hint="8 dígitos; le avisaremos por aquí del estado de su pedido."
            maxLength={20}
            required
          />
          <Field label="Correo (opcional)" name="email" type="email" autoComplete="email" defaultValue={values.email} error={errors.email} maxLength={120} />
        </fieldset>

        <fieldset className="csec">
          <legend>
            <span className="csec__n">2</span> Entrega
          </legend>
          <div className="choice-row" role="radiogroup" aria-label="Cómo recibir">
            {info.zones.length > 0 ? (
              <label className="choice">
                <input type="radio" name="fulfillment" value="delivery" checked={fulfillment === "delivery"} onChange={() => setFulfillment("delivery")} />
                <span>
                  <strong>A domicilio</strong>
                  <small>Lo llevamos a su dirección</small>
                </span>
              </label>
            ) : null}
            {info.pickup.length > 0 ? (
              <label className="choice">
                <input type="radio" name="fulfillment" value="pickup" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")} />
                <span>
                  <strong>Recojo en tienda</strong>
                  <small>Sin costo</small>
                </span>
              </label>
            ) : null}
          </div>
          {errors.fulfillment ? <p className="field__error" role="alert">{errors.fulfillment}</p> : null}

          {fulfillment === "delivery" ? (
            <>
              <div className="field">
                <label className="field__label" htmlFor="zoneId">Zona de entrega</label>
                <select id="zoneId" name="zoneId" className="field__control" value={zoneId} onChange={(e) => setZoneId(e.target.value)} aria-invalid={errors.zoneId ? true : undefined}>
                  {info.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} · {formatBs(z.fee)}
                    </option>
                  ))}
                </select>
                {zone?.description ? <p className="field__hint">{zone.description}</p> : null}
                {errors.zoneId ? <p className="field__error" role="alert">{errors.zoneId}</p> : null}
              </div>
              <Field label="Dirección" name="address" autoComplete="street-address" defaultValue={values.address} error={errors.address} maxLength={200} />
              <Field label="Referencia (opcional)" name="reference" defaultValue={values.reference} error={errors.reference} maxLength={200} hint="Color de la casa, tienda cercana, piso…" />
            </>
          ) : (
            <div className="field">
              <label className="field__label" htmlFor="pickupId">Dónde recoger</label>
              <select id="pickupId" name="pickupId" className="field__control" defaultValue={values.pickupId ?? info.pickup[0]?.id} aria-invalid={errors.pickupId ? true : undefined}>
                {info.pickup.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.address ? ` · ${p.address}` : ""}
                  </option>
                ))}
              </select>
              {errors.pickupId ? <p className="field__error" role="alert">{errors.pickupId}</p> : null}
            </div>
          )}
        </fieldset>

        <fieldset className="csec">
          <legend>
            <span className="csec__n">3</span> Pago
          </legend>
          <div className="choice-row" role="radiogroup" aria-label="Método de pago">
            {payments.map((provider) => (
              <label className="choice" key={provider.id}>
                <input type="radio" name="paymentMethod" value={provider.method} checked={paymentMethod === provider.method} onChange={() => setPaymentMethod(provider.method)} />
                <span>
                  <strong>{provider.label}</strong>
                  <small>{provider.description}</small>
                </span>
              </label>
            ))}
          </div>
          {errors.paymentMethod ? <p className="field__error" role="alert">{errors.paymentMethod}</p> : null}
        </fieldset>

        <fieldset className="csec">
          <legend>
            <span className="csec__n">4</span> Factura y notas
          </legend>
          <label className="scheck">
            <input type="checkbox" name="wantsInvoice" checked={wantsInvoice} onChange={(e) => setWantsInvoice(e.target.checked)} />
            <span>Quiero factura</span>
          </label>
          {wantsInvoice ? (
            <div className="csec__pair">
              <Field label="NIT o CI" name="invoiceNit" defaultValue={values.invoiceNit} error={errors.invoiceNit} maxLength={20} />
              <Field label="Razón social" name="invoiceName" defaultValue={values.invoiceName} error={errors.invoiceName} maxLength={120} />
            </div>
          ) : null}
          <Field label="Nota para el pedido (opcional)" name="notes" defaultValue={values.notes} error={errors.notes} maxLength={300} />
        </fieldset>

        {/* honeypot: people never see it; bots fill it */}
        <div className="hp" aria-hidden="true">
          <label>
            Sitio web
            <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        <input type="hidden" name="idempotencyKey" value={key} />
        <input type="hidden" name="items" value={JSON.stringify(cart.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })))} />
      </div>

      <aside className="checkout__summary" aria-label="Resumen del pedido">
        <h2>Su pedido</h2>
        {details.status === "loading" ? <p role="status">Calculando…</p> : null}
        {details.status === "error" ? <p className="notice notice--error" role="alert">{details.message}</p> : null}
        {details.status === "ready" ? (
          <>
            <ul className="scart__lines scart__lines--compact">
              {details.lines.map((line) => (
                <CartLineRow key={line.variantId} line={line} />
              ))}
            </ul>
            <dl className="sum">
              <div>
                <dt>Subtotal</dt>
                <dd className="num">{formatBs(details.subtotal)}</dd>
              </div>
              <div>
                <dt>{fulfillment === "delivery" ? "Envío" : "Recojo"}</dt>
                <dd className="num">{fulfillment === "delivery" ? formatBs(fee) : "Gratis"}</dd>
              </div>
              <div className="sum__total">
                <dt>Total</dt>
                <dd className="num">{formatBs(total)}</dd>
              </div>
            </dl>
            {details.hasProblems ? (
              <p className="notice notice--error" role="alert">
                Hay productos con problemas de stock. <Link href="/tienda/carrito">Revise su carrito</Link>.
              </p>
            ) : null}
          </>
        ) : null}
        <button className="btn btn--primary checkout__submit" type="submit" disabled={blocked}>
          {pending ? "Enviando su pedido…" : `Confirmar pedido · ${formatBs(total)}`}
        </button>
        <p className="checkout__fine">
          {paymentMethod === "qr" ? "Al confirmar verá el QR y el monto exacto para pagar." : "Pagará al recibir o recoger su pedido."}
        </p>
      </aside>
    </form>
  );
}
