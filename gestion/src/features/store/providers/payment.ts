import type { PaymentMethodWeb } from "../order-state";

/**
 * Payment seam. Today the shop has no merchant account with a card gateway, so two MANUAL providers exist:
 *   - manual_qr: the buyer pays the shop's bank QR from their banking app, then uploads the proof;
 *   - cash_on_delivery: paid at delivery / pickup (cash or QR), registered by whoever hands the order over.
 *
 * To add a card gateway (Stripe, PagoPlux, Tigo Money, ...): implement `PaymentProvider` with kind "online",
 * create the provider's checkout session in `startPayment()` (store its id on the order), and confirm the order
 * from the provider's signed webhook by calling the same `web_order_confirm` flow (never from the browser).
 * A fake card form must NOT be added without a real merchant account.
 */
export interface PaymentProvider {
  readonly id: string;
  readonly method: PaymentMethodWeb;
  readonly label: string;
  readonly description: string;
  /** Does the buyer have to send a proof (image or transaction number) after ordering? */
  readonly requiresProof: boolean;
  /** "manual": a person confirms. "online": a gateway webhook confirms. */
  readonly confirmation: "manual" | "online";
}

export const manualQrProvider: PaymentProvider = {
  id: "manual_qr",
  method: "qr",
  label: "QR bancario",
  description: "Pague con el QR desde su app del banco y suba el comprobante. Confirmamos su pago manualmente.",
  requiresProof: true,
  confirmation: "manual",
};

export const cashOnDeliveryProvider: PaymentProvider = {
  id: "cash_on_delivery",
  method: "contra_entrega",
  label: "Contra entrega / en tienda",
  description: "Pague al recibir su pedido o al recogerlo (efectivo o QR). Confirmamos su pedido antes de prepararlo.",
  requiresProof: false,
  confirmation: "manual",
};

export const PAYMENT_PROVIDERS: readonly PaymentProvider[] = [manualQrProvider, cashOnDeliveryProvider];

export function providerFor(method: PaymentMethodWeb): PaymentProvider {
  return method === "qr" ? manualQrProvider : cashOnDeliveryProvider;
}
