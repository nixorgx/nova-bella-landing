import { PAYMENT_LABEL, type PaymentMethod } from "../payments";
import { DOC_LABEL, type DocType } from "../queries";

export function DocBadge({ type, channel }: { type: DocType; channel?: "store" | "web" }) {
  return (
    <>
      <span className="badge doc-badge">{DOC_LABEL[type]}</span>
      {channel === "web" ? <span className="badge badge--low">Web</span> : null}
    </>
  );
}

export function StatusBadge({ status }: { status: "completed" | "voided" }) {
  return status === "voided" ? <span className="badge badge--void">Anulada</span> : null;
}

export function MethodChips({ methods }: { methods: readonly PaymentMethod[] }) {
  if (methods.length === 0) return <span className="is-muted">—</span>;
  return (
    <span className="method-chips">
      {methods.map((method) => (
        <span key={method} className="badge badge--ok">{PAYMENT_LABEL[method]}</span>
      ))}
    </span>
  );
}
