import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Pagination } from "@/components/ui/Pagination";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { one, type RawSearchParams } from "@/lib/search-params";
import { countByStatus, listOrders } from "@/features/orders/queries";
import { ExpireUnpaid } from "@/features/orders/ui/ExpireUnpaid";
import { OrderStatusBadge } from "@/features/orders/ui/OrderBadges";
import { formatBoPhone } from "@/features/store/phone";
import { isOrderStatus, ORDER_STATUSES, STATUS_LABEL } from "@/features/store/order-state";

export const metadata: Metadata = { title: "Pedidos web" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin", "seller");
  const params = await searchParams;
  const session = toSession(user);
  const statusParam = one(params.estado);
  const status = isOrderStatus(statusParam) ? statusParam : undefined;
  const q = one(params.q)?.slice(0, 60);
  const [counts, orders] = await Promise.all([countByStatus(session), listOrders(session, { status, q }, parsePageRequest(params))]);
  const total = ORDER_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const tab = (value: OrderStatusKey, label: string, n: number) => {
    const href = value === "todos" ? `/pedidos${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/pedidos?estado=${value}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    const current = (value === "todos" && !status) || value === status;
    return (
      <li key={value}>
        <Link className="otab" href={href} aria-current={current ? "page" : undefined}>
          {label} <span className="otab__n num">{n}</span>
        </Link>
      </li>
    );
  };

  return (
    <div className="page page--wide">
      <PageHead
        eyebrow="Tienda online"
        title="Pedidos web"
        description={user.role === "superadmin" ? "Confirme pagos, prepare y entregue. Cada confirmación crea la venta (canal web) y descuenta el stock." : "Los pedidos de su sucursal: prepare, envíe y entregue."}
      />
      {user.role === "superadmin" ? <ExpireUnpaid /> : null}
      <nav aria-label="Estados de pedidos">
        <ul className="otabs">
          {tab("todos", "Todos", total)}
          {ORDER_STATUSES.map((s) => tab(s, STATUS_LABEL[s], counts[s]))}
        </ul>
      </nav>
      <section className="panel" aria-labelledby="orders-title">
        <div className="panel__head">
          <h2 id="orders-title">{status ? STATUS_LABEL[status] : "Todos los pedidos"}</h2>
          <span className="eyebrow">{orders.total} {orders.total === 1 ? "pedido" : "pedidos"}</span>
        </div>
        <div className="panel__body">
          <form method="get" action="/pedidos" role="search" aria-label="Buscar pedidos" className="inline-add">
            {status ? <input type="hidden" name="estado" value={status} /> : null}
            <div className="field">
              <label className="field__label" htmlFor="o-q">Código, nombre o celular</label>
              <input id="o-q" name="q" type="search" className="field__control" defaultValue={q ?? ""} autoComplete="off" />
            </div>
            <button type="submit" className="btn">Buscar</button>
            {q ? <Link href={status ? `/pedidos?estado=${status}` : "/pedidos"} className="btn btn--quiet">Limpiar</Link> : null}
          </form>
        </div>
        {orders.rows.length === 0 ? (
          <div className="panel__body">
            <EmptyState title="No hay pedidos aquí">Cuando un cliente compre en la tienda, el pedido aparecerá en esta lista.</EmptyState>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">Pedido</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Entrega</th>
                  <th scope="col">Pago</th>
                  <th scope="col" className="num">Total</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {orders.rows.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Pedido"><Link className="row-link" href={`/pedidos/${o.id}`}>{o.code}</Link></td>
                    <td data-label="Fecha">{formatDateTime(o.createdAt)}</td>
                    <td data-label="Cliente">{o.customerName}<br /><span className="is-muted">{formatBoPhone(o.phone)}</span></td>
                    <td data-label="Entrega">{o.fulfillment === "delivery" ? "Domicilio" : "Recojo"}</td>
                    <td data-label="Pago">{o.paymentMethod === "qr" ? "QR" : "Contra entrega"}{o.proofCount > 0 ? " · con comprobante" : ""}</td>
                    <td data-label="Total" className="num">{formatBs(o.total)}</td>
                    <td data-label="Estado"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={orders} basePath="/pedidos" label="pedidos" params={{ estado: status, q }} />
      </section>
    </div>
  );
}

type OrderStatusKey = "todos" | (typeof ORDER_STATUSES)[number];
