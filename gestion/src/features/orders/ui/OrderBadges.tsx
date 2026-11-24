import { STATUS_LABEL, STATUS_TONE, type OrderStatus } from "@/features/store/order-state";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const tone = STATUS_TONE[status];
  return <span className={`badge ${tone === "neutral" ? "" : `badge--${tone}`}`}>{STATUS_LABEL[status]}</span>;
}
