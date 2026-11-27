import { RankedBars } from "@/components/charts/RankedBars";
import { formatBs, sumMoney } from "@/lib/money";
import { PAYMENT_LABEL } from "@/features/sales/payments";
import type { MethodRow } from "../aggregate";

/** Cobrado por método: ranked bars on the net amount, and the table that adds exchange differences. */
export function MethodBreakdown({ methods }: { methods: readonly MethodRow[] }) {
  const ranked = [...methods].sort((a, b) => Number(b.net) - Number(a.net));
  const total = sumMoney(methods.map((m) => m.net));
  return (
    <section className="panel" aria-labelledby="methods-title">
      <div className="panel__head">
        <h2 id="methods-title">Cobrado por método de pago</h2>
        <span className="eyebrow">Ventas + diferencias de cambios</span>
      </div>
      <div className="panel__body stack">
        <RankedBars
          label="Total cobrado por método de pago"
          items={ranked.map((m) => ({ key: m.method, label: PAYMENT_LABEL[m.method], value: Number(m.net), valueLabel: formatBs(m.net) }))}
        />
        <div className="table-wrap">
          <table className="table table--stack">
            <thead>
              <tr>
                <th scope="col">Método</th>
                <th scope="col" className="num">Ventas</th>
                <th scope="col" className="num">Cambios (neto)</th>
                <th scope="col" className="num">Total cobrado</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.method}>
                  <th scope="row" data-label="Método">{PAYMENT_LABEL[m.method]}</th>
                  <td data-label="Ventas" className="num">{formatBs(m.sales)}</td>
                  <td data-label="Cambios (neto)" className="num">{formatBs(m.exchanges)}</td>
                  <td data-label="Total cobrado" className="num"><strong>{formatBs(m.net)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td data-label="Ventas" className="num">{formatBs(sumMoney(methods.map((m) => m.sales)))}</td>
                <td data-label="Cambios (neto)" className="num">{formatBs(sumMoney(methods.map((m) => m.exchanges)))}</td>
                <td data-label="Total cobrado" className="num"><strong>{formatBs(total)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}
