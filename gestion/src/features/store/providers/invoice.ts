/**
 * Invoice seam. Real electronic invoicing in Bolivia (SIN) requires an authorized provider / system and the
 * shop's tax registration; that choice is pending with the client and her advisor (see docs/GUIA-TIENDA).
 * Until then the buyer only states NIT/CI and razon social ("Quiero factura") and the shop issues the invoice
 * by hand with its current method. The order keeps `invoice_status = 'pending_manual'` as the work queue.
 *
 * To integrate a provider: implement `InvoiceProvider.issue()` (call the provider's API with the order data),
 * store the returned document number / link on the order and set `invoice_status = 'issued'`.
 */
export interface InvoiceRequest {
  readonly orderCode: string;
  readonly nit: string;
  readonly legalName: string;
  readonly total: string;
  readonly lines: readonly { description: string; qty: number; unitPrice: string }[];
}

export type InvoiceResult =
  | { readonly status: "pending_manual" }
  | { readonly status: "issued"; readonly number: string; readonly url?: string };

export interface InvoiceProvider {
  readonly id: string;
  issue(request: InvoiceRequest): Promise<InvoiceResult>;
}

/** The shop issues the invoice by hand (current state). */
export const manualInvoiceProvider: InvoiceProvider = {
  id: "manual",
  async issue() {
    return { status: "pending_manual" };
  },
};
