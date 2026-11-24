import { formatDateTime } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { PAYMENT_LABEL } from "@/features/sales/payments";
import type { ExchangeGroup } from "../queries";

/** Exchanges of a sale, newest last, each with its receipt link. */
export function ExchangeHistory({ saleId, groups }: { saleId: string; groups: readonly ExchangeGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="xh-title">
      <div className="panel__head"><h2 id="xh-title">Cambios de esta venta</h2><span className="badge badge--cambio">{groups.length}</span></div>
      <ol className="xhistory">
        {groups.map((group) => {
          const net = group.net;
          return (
            <li key={group.groupId}>
              <p className="xhistory__when">
                <strong>{formatDateTime(group.createdAt)}</strong>
                <span className="is-muted">{group.createdByName ? ` · ${group.createdByName}` : ""}{group.reason ? ` · ${group.reason}` : ""}</span>
              </p>
              <ul className="xhistory__lines">
                {group.lines.map((line) => (
                  <li key={line.id}>
                    <span>
                      {line.qty} × {line.returned.model} {line.returned.color} T{line.returned.size}
                      <span aria-hidden="true"> → </span><span className="sr-only"> cambiado por </span>
                      {line.replacement.model} {line.replacement.color} T{line.replacement.size}
                    </span>
                    <span className="num">{line.priceDiff === "0.00" ? "Sin diferencia" : formatBs(line.priceDiff)}</span>
                  </li>
                ))}
              </ul>
              <p className="xhistory__net">
                <span>
                  {net === "0.00" ? "Cambio parejo" : net.startsWith("-") ? `Se devolvió ${formatBs(net.slice(1))}` : `Se cobró ${formatBs(net)}`}
                  {group.paymentMethod ? ` · ${PAYMENT_LABEL[group.paymentMethod]}` : ""}
                </span>
                <a className="row-link" href={`/ventas/${saleId}/ticket?cambio=${group.groupId}`}>Ticket del cambio</a>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
