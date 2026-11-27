export const EXCHANGE_REASONS = ["talla", "regalo", "defecto", "modelo", "otro"] as const;
export type ExchangeReason = (typeof EXCHANGE_REASONS)[number];

export const EXCHANGE_REASON_LABEL: Readonly<Record<ExchangeReason, string>> = {
  talla: "Talla equivocada",
  regalo: "Era un regalo",
  defecto: "Defecto de fábrica",
  modelo: "Cambio de modelo",
  otro: "Otro motivo",
};

/** The text stored in exchanges.reason: the label, plus the free note when there is one. */
export function exchangeReasonText(reason: ExchangeReason, note: string | undefined): string {
  const detail = note?.trim();
  return detail ? `${EXCHANGE_REASON_LABEL[reason]}: ${detail}` : EXCHANGE_REASON_LABEL[reason];
}
