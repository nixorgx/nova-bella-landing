import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime, formatPlainDate, todayKey } from "@/lib/format";
import { dec } from "@/lib/money";
import { formatRateInput } from "@/lib/number-input";
import { listRates } from "@/features/purchases/rates";
import { RateForm } from "@/features/purchases/ui/RateForm";

export const metadata: Metadata = { title: "Tipos de cambio" };

export default async function RatesPage() {
  const user = await requireRole("superadmin");
  const rates = await listRates(toSession(user));
  const latest = rates[0];

  return (
    <div className="page">
      <PageHead eyebrow="Ingreso de mercadería" title="Tipos de cambio" description="Registre el oficial y el paralelo. Cada lote guarda su propio tipo de cambio." />
      <div className="users-layout">
        <section className="panel panel--cost" aria-labelledby="rates-title">
          <div className="panel__head">
            <h2 id="rates-title">Historial</h2>
            <span className="cost-tag">Costo · solo superadmin</span>
          </div>
          {rates.length === 0 ? (
            <div className="panel__body">
              <EmptyState title="Aún no hay tipos de cambio">Registre el primero con el formulario.</EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table table--stack table--cost">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col" className="num">Oficial</th>
                    <th scope="col" className="num">Paralelo</th>
                    <th scope="col" className="num">Diferencia</th>
                    <th scope="col">Registrado por</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((rate, index) => {
                    const gap = dec(rate.parallelRate).minus(rate.officialRate).toFixed(2).replace(".", ",");
                    return (
                      <tr key={rate.id}>
                        <td data-label="Fecha">
                          {formatPlainDate(rate.rateDate)} {index === 0 ? <span className="badge badge--ok">Último</span> : null}
                        </td>
                        <td data-label="Oficial" className="num cost">{formatRateInput(rate.officialRate)}</td>
                        <td data-label="Paralelo" className="num cost">{formatRateInput(rate.parallelRate)}</td>
                        <td data-label="Diferencia" className="num">{gap}</td>
                        <td data-label="Registrado por">{rate.createdByName ?? "—"} <span className="is-muted">· {formatDateTime(rate.createdAt)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="new-rate-title">
          <div className="panel__head"><h2 id="new-rate-title">Nuevo tipo de cambio</h2></div>
          <div className="panel__body">
            <RateForm today={todayKey()} official={latest ? formatRateInput(latest.officialRate) : undefined} parallel={latest ? formatRateInput(latest.parallelRate) : undefined} />
          </div>
        </section>
      </div>
    </div>
  );
}
