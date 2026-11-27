import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Pagination } from "@/components/ui/Pagination";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDate } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { one, type RawSearchParams } from "@/lib/search-params";
import { listCustomers } from "@/features/customers/queries";
import { NewCustomerForm } from "@/features/customers/ui/NewCustomerForm";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin", "seller");
  const params = await searchParams;
  const q = one(params.q)?.slice(0, 60);
  const customers = await listCustomers(toSession(user), q, parsePageRequest(params));

  return (
    <div className="page page--wide">
      <PageHead eyebrow="Ventas" title="Clientes" description="Quién compra y cuánto: el historial de cada cliente está a un clic." />
      <div className="customers-layout">
        <section className="panel" aria-labelledby="customers-title">
          <div className="panel__head">
            <h2 id="customers-title">Cartera de clientes</h2>
            <span className="eyebrow">{customers.total} {customers.total === 1 ? "cliente" : "clientes"}</span>
          </div>
          <div className="panel__body">
            <form method="get" action="/clientes" role="search" aria-label="Buscar clientes" className="inline-add">
              <div className="field">
                <label className="field__label" htmlFor="c-q">Buscar por nombre, teléfono o CI/NIT</label>
                <input id="c-q" name="q" type="search" className="field__control" defaultValue={q ?? ""} autoComplete="off" />
              </div>
              <button type="submit" className="btn">Buscar</button>
              {q ? <Link href="/clientes" className="btn btn--quiet">Limpiar</Link> : null}
            </form>
          </div>
          {customers.rows.length === 0 ? (
            <div className="panel__body">
              <EmptyState title={q ? "Ningún cliente coincide" : "Todavía no hay clientes"}>
                {q ? "Pruebe con otro nombre o número." : "Agregue el primero con el formulario o desde el punto de venta."}
              </EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">CI / NIT</th>
                    <th scope="col">Teléfono</th>
                    <th scope="col" className="num">Compras</th>
                    <th scope="col" className="num">Total gastado</th>
                    <th scope="col">Última compra</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.rows.map((customer) => (
                    <tr key={customer.id}>
                      <td data-label="Cliente"><Link className="row-link clip-2" href={`/clientes/${customer.id}`}>{customer.name}</Link></td>
                      <td data-label="CI / NIT">{customer.ciNit ?? "—"}</td>
                      <td data-label="Teléfono">{customer.phone ?? "—"}</td>
                      <td data-label="Compras" className="num">{customer.purchases}</td>
                      <td data-label="Total gastado" className="num">{customer.purchases ? formatBs(customer.spent) : "—"}</td>
                      <td data-label="Última compra">{customer.lastPurchaseAt ? formatDate(customer.lastPurchaseAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={customers} basePath="/clientes" label="clientes" params={{ q }} />
        </section>
        <section className="panel" aria-labelledby="new-customer-title">
          <div className="panel__head"><h2 id="new-customer-title">Nuevo cliente</h2></div>
          <div className="panel__body"><NewCustomerForm compact /></div>
        </section>
      </div>
    </div>
  );
}
