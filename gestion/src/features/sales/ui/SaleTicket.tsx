import { formatDateTime, saleNumberLabel } from "@/lib/format";
import { dec, formatBs } from "@/lib/money";
import { PAYMENT_LABEL } from "../payments";
import { DOC_LABEL, type SaleDetail } from "../queries";

/** 80 mm receipt. Prices charged only (list price appears just to show the discount). */
export function SaleTicket({ sale }: { sale: SaleDetail }) {
  const hasDiscount = sale.discount !== "0.00";
  return (
    <article className="ticket" aria-label={`Ticket de la venta ${saleNumberLabel(sale.saleNumber)}`}>
      <header className="ticket__head">
        <p className="ticket__brand">NOVABELLA</p>
        <p>Calzados</p>
        <p>{sale.branchName}{sale.branchCity ? ` · ${sale.branchCity}` : ""}</p>
      </header>

      <p className="ticket__doc">
        {DOC_LABEL[sale.docType]} N° {saleNumberLabel(sale.saleNumber)}
        {sale.status === "voided" ? " · ANULADA" : ""}
      </p>
      {sale.exchanges.length > 0 ? <p className="ticket__flag">CAMBIO REGISTRADO</p> : null}
      <dl className="ticket__meta">
        <div><dt>Fecha</dt><dd>{formatDateTime(sale.createdAt)}</dd></div>
        <div><dt>Vendedor</dt><dd>{sale.sellerName ?? "—"}</dd></div>
        <div><dt>Cliente</dt><dd>{sale.customer?.name ?? "Sin nombre"}</dd></div>
        {sale.customer?.ciNit ? <div><dt>CI/NIT</dt><dd>{sale.customer.ciNit}</dd></div> : null}
      </dl>

      <ul className="ticket__lines" aria-label="Productos">
        {sale.lines.map((line) => {
          const discounted = line.finalPrice !== line.listPrice;
          return (
            <li key={line.sku}>
              <span className="ticket__item">
                {line.qty} × {line.model} {line.color} T{line.size}
              </span>
              <span className="ticket__amount">{formatBs(dec(line.finalPrice).times(line.qty).toFixed(2))}</span>
              <span className="ticket__sub">
                {formatBs(line.finalPrice)} c/u{discounted ? ` (lista ${formatBs(line.listPrice)})` : ""}
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="ticket__totals">
        {hasDiscount ? (
          <>
            <div><dt>Subtotal</dt><dd>{formatBs(sale.listTotal)}</dd></div>
            <div><dt>Descuento</dt><dd>− {formatBs(sale.discount)}</dd></div>
          </>
        ) : null}
        <div className="ticket__grand"><dt>TOTAL</dt><dd>{formatBs(sale.total)}</dd></div>
      </dl>

      <dl className="ticket__pays" aria-label="Pagos">
        {sale.payments.map((payment, index) => (
          <div key={`${payment.method}-${index}`}><dt>{PAYMENT_LABEL[payment.method]}</dt><dd>{formatBs(payment.amount)}</dd></div>
        ))}
      </dl>

      {sale.exchanges.length > 0 ? (
        <section className="ticket__exchanges" aria-label="Cambios de esta venta">
          <p className="ticket__subhead">CAMBIOS</p>
          <ul>
            {sale.exchanges.flatMap((group) =>
              group.lines.map((line) => (
                <li key={line.id}>
                  <span className="ticket__item">
                    {line.qty} × {line.returned.model} T{line.returned.size} → {line.replacement.model} T{line.replacement.size}
                  </span>
                  <span className="ticket__amount">{line.priceDiff === "0.00" ? "sin dif." : formatBs(line.priceDiff)}</span>
                </li>
              )),
            )}
          </ul>
        </section>
      ) : null}

      <footer className="ticket__foot">
        <p>¡Gracias por su compra!</p>
        <p>Comprobante interno de venta · {DOC_LABEL[sale.docType]}</p>
      </footer>
    </article>
  );
}
