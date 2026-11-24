import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "@/features/sales/payments";
import type { CashSessionReport } from "../session-report";

export function DifferenceBadge({ difference, status }: { difference: string | null; status: "open" | "closed" }) {
  if (status === "open" || difference === null) return <span className="badge status-open">Abierta</span>;
  if (difference === "0.00") return <span className="badge badge--ok">Cuadra</span>;
  const missing = difference.startsWith("-");
  return (
    <span className={`diff diff--${missing ? "short" : "over"}`}>
      {missing ? "Falta " : "Sobra "}
      {formatBs(difference.replace("-", ""))}
    </span>
  );
}

/** Sessions with the four payment methods side by side; `detailBase` is where each row links to. */
export function CashSessionTable({ sessions, detailBase, showBranch }: { sessions: readonly CashSessionReport[]; detailBase: string; showBranch: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table table--stack">
        <thead>
          <tr>
            <th scope="col">Apertura</th>
            {showBranch ? <th scope="col">Sucursal</th> : null}
            <th scope="col">Cajero</th>
            <th scope="col" className="num">Ventas</th>
            {PAYMENT_METHODS.map((method) => <th key={method} scope="col" className="num">{PAYMENT_LABEL[method]}</th>)}
            <th scope="col" className="num">Esperado</th>
            <th scope="col" className="num">Contado</th>
            <th scope="col">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((cash) => (
            <tr key={cash.id}>
              <td data-label="Apertura" className="nowrap">
                <Link className="row-link" href={`${detailBase}/${cash.id}`}>{formatDateTime(cash.openedAt)}</Link>
                {cash.closedAt ? null : <span className="is-muted"> · en curso</span>}
              </td>
              {showBranch ? <td data-label="Sucursal">{cash.branchName}</td> : null}
              <td data-label="Cajero"><span className="clip-2">{cash.openedByName ?? "—"}</span></td>
              <td data-label="Ventas" className="num">
                {cash.salesCount}
                {cash.voidCount > 0 ? <span className="is-muted"> (+{cash.voidCount} anul.)</span> : null}
              </td>
              {cash.methods.map((m) => <td key={m.method} data-label={PAYMENT_LABEL[m.method]} className="num">{formatBs(m.net)}</td>)}
              <td data-label="Esperado" className="num">{formatBs(cash.expectedCash)}</td>
              <td data-label="Contado" className="num">{cash.closingAmount === null ? "—" : formatBs(cash.closingAmount)}</td>
              <td data-label="Resultado"><DifferenceBadge difference={cash.difference} status={cash.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
