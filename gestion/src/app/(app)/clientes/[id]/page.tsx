import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime, saleNumberLabel } from "@/lib/format";
import { D, dec, formatBs } from "@/lib/money";
import { uuidParam } from "@/lib/search-params";
import { getCustomer } from "@/features/customers/queries";
import { EditCustomerForm } from "@/features/customers/ui/EditCustomerForm";
import { DocBadge, StatusBadge } from "@/features/sales/ui/SaleBadges";

export const metadata: Metadata = { title: "Cliente" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("superadmin", "seller");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const customer = await getCustomer(toSession(user), id);
  if (!customer) notFound();
  const completed = customer.sales.filter((sale) => sale.status === "completed");
  const spent = completed.reduce((sum, sale) => sum.plus(dec(sale.total)), new D(0));

  return (
    <div className="page page--wide">
      <PageHead eyebrow="Cliente" title={customer.name} description={[customer.ciNit && `CI/NIT ${customer.ciNit}`, customer.phone].filter(Boolean).join(" · ") || undefined}>
        <Link href="/clientes" className="btn btn--quiet">Volver a clientes</Link>
      </PageHead>
      <div className="customers-layout">
        <section className="panel" aria-labelledby="history-title">
          <div className="panel__head">
            <h2 id="history-title">Historial de compras</h2>
            <span className="eyebrow">{completed.length} {completed.length === 1 ? "compra" : "compras"} · {formatBs(spent.toFixed(2))}</span>
          </div>
          {customer.sales.length === 0 ? (
            <div className="panel__body"><EmptyState title="Sin compras todavía">Cuando compre algo, aparecerá aquí.</EmptyState></div>
          ) : (
            <div className="table-wrap">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th scope="col">N°</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Documento</th>
                    <th scope="col" className="num">Pares</th>
                    <th scope="col" className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.sales.map((sale) => (
                    <tr key={sale.id} className={sale.status === "voided" ? "is-muted" : undefined}>
                      <td data-label="N°"><Link className="row-link" href={`/ventas/${sale.id}`}>{saleNumberLabel(sale.saleNumber)}</Link> <StatusBadge status={sale.status} /></td>
                      <td data-label="Fecha" className="num">{formatDateTime(sale.createdAt)}</td>
                      <td data-label="Documento"><DocBadge type={sale.docType} /></td>
                      <td data-label="Pares" className="num">{sale.units}</td>
                      <td data-label="Total" className="num"><strong>{formatBs(sale.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="edit-title">
          <div className="panel__head"><h2 id="edit-title">Datos del cliente</h2></div>
          <div className="panel__body"><EditCustomerForm customer={customer} /></div>
        </section>
      </div>
    </div>
  );
}
