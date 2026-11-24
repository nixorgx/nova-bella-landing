/**
 * Order lifecycle (mirror of migrations 020/021; both sides are tested):
 *
 *   pendiente_pago -> pago_en_revision -> confirmado -> en_camino | listo_para_recoger -> entregado
 *                  \-> cancelado (any non-final state, superadmin, with reason; the buyer may cancel while unpaid)
 *   pago_en_revision -> pendiente_pago (superadmin rejects the proof with a reason)
 */
export const ORDER_STATUSES = [
  "pendiente_pago",
  "pago_en_revision",
  "confirmado",
  "en_camino",
  "listo_para_recoger",
  "entregado",
  "cancelado",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type PaymentMethodWeb = "qr" | "contra_entrega";
export type Fulfillment = "delivery" | "pickup";

export const STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  pendiente_pago: "Pendiente de pago",
  pago_en_revision: "Pago en revisión",
  confirmado: "Confirmado",
  en_camino: "En camino",
  listo_para_recoger: "Listo para recoger",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

/** Which badge tone a status gets in the admin lists. */
export const STATUS_TONE: Readonly<Record<OrderStatus, "low" | "ok" | "out" | "neutral">> = {
  pendiente_pago: "low",
  pago_en_revision: "low",
  confirmado: "ok",
  en_camino: "ok",
  listo_para_recoger: "ok",
  entregado: "neutral",
  cancelado: "out",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export interface OrderShape {
  readonly status: OrderStatus;
  readonly paymentMethod: PaymentMethodWeb;
  readonly fulfillment: Fulfillment;
}

/** Statuses that still need somebody to act (new-orders badge). */
export const NEEDS_PAYMENT_ACTION: readonly OrderStatus[] = ["pendiente_pago", "pago_en_revision"];
export const NEEDS_DISPATCH: readonly OrderStatus[] = ["confirmado", "en_camino", "listo_para_recoger"];

export function isFinal(status: OrderStatus): boolean {
  return status === "entregado" || status === "cancelado";
}

export type AdminAction = "confirm" | "reject_proof" | "ship" | "ready" | "deliver" | "cancel";

/** Actions the superadmin may take; the database enforces the same rules. */
export function adminActions(order: OrderShape): readonly AdminAction[] {
  const { status, fulfillment } = order;
  const actions: AdminAction[] = [];
  if (status === "pendiente_pago" || status === "pago_en_revision") actions.push("confirm");
  if (status === "pago_en_revision") actions.push("reject_proof");
  if (status === "confirmado") actions.push(fulfillment === "delivery" ? "ship" : "ready");
  if (status === "confirmado" || status === "en_camino" || status === "listo_para_recoger") actions.push("deliver");
  if (!isFinal(status)) actions.push("cancel");
  return actions;
}

/** Operational steps a seller may take (never payment confirmation or cancellation). */
export function sellerActions(order: OrderShape): readonly AdminAction[] {
  return adminActions(order).filter((action) => action === "ship" || action === "ready" || action === "deliver");
}

/** Visible steps of the buyer's progress bar (cancelled orders show their own state). */
export function progressSteps(order: Pick<OrderShape, "fulfillment" | "paymentMethod">): readonly { status: OrderStatus; label: string }[] {
  const middle: { status: OrderStatus; label: string }[] =
    order.fulfillment === "delivery"
      ? [{ status: "en_camino", label: "En camino" }]
      : [{ status: "listo_para_recoger", label: "Listo para recoger" }];
  return [
    { status: "pendiente_pago", label: order.paymentMethod === "qr" ? "Pago" : "Pedido recibido" },
    { status: "confirmado", label: "Confirmado" },
    ...middle,
    { status: "entregado", label: "Entregado" },
  ];
}

const RANK: Readonly<Record<OrderStatus, number>> = {
  pendiente_pago: 0,
  pago_en_revision: 0,
  confirmado: 1,
  en_camino: 2,
  listo_para_recoger: 2,
  entregado: 3,
  cancelado: -1,
};

/** Index of the current step inside `progressSteps` (-1 for cancelled). */
export function progressIndex(status: OrderStatus): number {
  return RANK[status];
}

/** One-line explanation for the buyer, per state. */
export function buyerHint(order: OrderShape): string {
  switch (order.status) {
    case "pendiente_pago":
      return order.paymentMethod === "qr"
        ? "Pague con el QR y suba su comprobante para que confirmemos su pedido."
        : "Recibimos su pedido. Lo confirmaremos y le avisaremos por WhatsApp.";
    case "pago_en_revision":
      return "Recibimos su comprobante. Estamos revisando el pago; le avisaremos apenas se confirme.";
    case "confirmado":
      return order.fulfillment === "delivery"
        ? "Pedido confirmado. Lo estamos preparando para el envío."
        : "Pedido confirmado. Lo estamos preparando; le avisaremos cuando esté listo para recoger.";
    case "en_camino":
      return "Su pedido va en camino a la dirección indicada.";
    case "listo_para_recoger":
      return "Su pedido está listo. Puede recogerlo en el punto elegido.";
    case "entregado":
      return "Pedido entregado. ¡Gracias por comprar en NovaBella!";
    case "cancelado":
      return "Este pedido fue cancelado.";
  }
}
