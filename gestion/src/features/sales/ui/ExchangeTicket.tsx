import { formatDateTime, saleNumberLabel } from "@/lib/format";
import { formatBs } from "@/lib/money";
import type { ExchangeGroup } from "@/features/exchanges/queries";
import { settlementOf } from "@/features/exchanges/price-diff";
import { PAYMENT_LABEL } from "../payments";
import type { SaleDetail } from "../queries";

/** 80 mm receipt of one exchange: what came back, what went out and how the difference was settled. */
export function ExchangeTicket({ sale, group }: { sale: SaleDetail; group: ExchangeGroup }) {
  const settlement = settlementOf(group.net);
  return (
    <article className="ticket" aria-label={`Comprobante de cambio de la venta ${saleNumberLabel(sale.saleNumber)}`}>
      <header className="ticket__head">
        <p className="ticket__brand">NOVABELLA</p>
        <p>Calzados</p>
        <p>{sale.branchName}{sale.branchCity ? ` · ${sale.branchCity}` : ""}</p>
      </header>

      <p className="ticket__doc">Comprobante de cambio</p>
      <p className="ticket__flag">CAMBIO</p>
      <dl className="ticket__meta">
        <div><dt>Fecha</dt><dd>{formatDateTime(group.createdAt)}</dd></div>
        <div><dt>Venta origen</dt><dd>N° {saleNumberLabel(sale.saleNumber)}</dd></div>
        <div><dt>Atendió</dt><dd>{group.createdByName ?? "—"}</dd></div>
        <div><dt>Cliente</dt><dd>{sale.customer?.name ?? "Sin nombre"}</dd></div>
      </dl>

      <ul className="ticket__lines" aria-label="Productos cambiados">
        {group.lines.map((line) => (
          <li key={line.id}>
            <span className="ticket__item">Devuelve: {line.qty} × {line.returned.model} {line.returned.color} T{line.returned.size}</span>
            <span className="ticket__amount" />
            <span className="ticket__item">Recibe: {line.qty} × {line.replacement.model} {line.replacement.color} T{line.replacement.size}</span>
            <span className="ticket__amount">{line.priceDiff === "0.00" ? "—" : formatBs(line.priceDiff)}</span>
          </li>
        ))}
      </ul>

      <dl className="ticket__totals">
        <div className="ticket__grand">
          <dt>{settlement.direction === "devolver" ? "SE DEVUELVE" : settlement.direction === "cobrar" ? "SE COBRA" : "DIFERENCIA"}</dt>
          <dd>{settlement.direction === "ninguna" ? "Bs 0,00" : formatBs(settlement.amount)}</dd>
        </div>
        {group.paymentMethod ? <div><dt>Método</dt><dd>{PAYMENT_LABEL[group.paymentMethod]}</dd></div> : null}
      </dl>
      {group.reason ? <p className="ticket__reason">Motivo: {group.reason}</p> : null}

      <footer className="ticket__foot">
        <p>¡Gracias por su preferencia!</p>
        <p>Conserve este comprobante junto a su ticket de venta</p>
      </footer>
    </article>
  );
}
