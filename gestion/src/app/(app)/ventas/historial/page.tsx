import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Pagination } from "@/components/ui/Pagination";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime, saleNumberLabel } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { dateParam, one, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions } from "@/features/branches/queries";
import { DOC_LABEL, listSales, listSellers, type DocType, type SaleFilters } from "@/features/sales/queries";
import { DocBadge, MethodChips, StatusBadge } from "@/features/sales/ui/SaleBadges";

export const metadata: Metadata = { title: "Historial de ventas" };

export default async function SalesHistoryPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin", "seller");
  const session = toSession(user);
  const isAdmin = user.role === "superadmin";
  const params = await searchParams;
  const doc = one(params.documento);
  const filters: SaleFilters = {
    from: dateParam(params.desde),
    to: dateParam(params.hasta),
    sellerId: uuidParam(params.vendedor),
    docType: doc === "factura" || doc === "nota_venta" ? (doc as DocType) : undefined,
    branchId: isAdmin ? uuidParam(params.sucursal) : undefined,
  };
  const [sales, sellers, branches] = await Promise.all([
    listSales(session, filters, parsePageRequest(params)),
    listSellers(session),
    isAdmin ? listBranchOptions(session, { includeInactive: true }) : Promise.resolve([]),
  ]);
  const filtered = Boolean(filters.from || filters.to || filters.sellerId || filters.docType || filters.branchId);

  return (
    <div className="page page--wide">
      <PageHead
        eyebrow={isAdmin ? "Todas las sucursales" : (user.branchName ?? "Mi sucursal")}
        title="Historial de ventas"
        description="Busque una venta, vea su detalle o vuelva a imprimir el ticket."
      />
      <section className="panel" aria-labelledby="sales-title">
        <div className="panel__head">
          <h2 id="sales-title">Ventas</h2>
          <span className="eyebrow">{sales.total} {sales.total === 1 ? "resultado" : "resultados"}</span>
        </div>
        <div className="panel__body">
          <form method="get" action="/ventas/historial" className="filters filters--sales" role="search" aria-label="Filtrar ventas">
            <div className="field">
              <label className="field__label" htmlFor="h-desde">Desde</label>
              <input id="h-desde" name="desde" type="date" className="field__control" defaultValue={filters.from ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="h-hasta">Hasta</label>
              <input id="h-hasta" name="hasta" type="date" className="field__control" defaultValue={filters.to ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="h-vendedor">Vendedor</label>
              <select id="h-vendedor" name="vendedor" className="field__control" defaultValue={filters.sellerId ?? ""}>
                <option value="">Todos</option>
                {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="h-doc">Documento</label>
              <select id="h-doc" name="documento" className="field__control" defaultValue={filters.docType ?? ""}>
                <option value="">Todos</option>
                {(Object.keys(DOC_LABEL) as DocType[]).map((type) => <option key={type} value={type}>{DOC_LABEL[type]}</option>)}
              </select>
            </div>
            {isAdmin ? (
              <div className="field">
                <label className="field__label" htmlFor="h-sucursal">Sucursal</label>
                <select id="h-sucursal" name="sucursal" className="field__control" defaultValue={filters.branchId ?? ""}>
                  <option value="">Todas</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            ) : null}
            <div className="filters__buttons">
              <button type="submit" className="btn">Filtrar</button>
              <Link href="/ventas/historial" className="btn btn--quiet">Limpiar</Link>
            </div>
          </form>
        </div>

        {sales.rows.length === 0 ? (
          <div className="panel__body">
            {filtered ? (
              <EmptyState title="Ninguna venta coincide" action={<Link href="/ventas/historial" className="btn btn--small">Quitar filtros</Link>}>
                Pruebe con otro rango de fechas, vendedor o tipo de documento.
              </EmptyState>
            ) : (
              <EmptyState title="Todavía no hay ventas" action={<Link href="/ventas" className="btn btn--primary btn--small">Ir al punto de venta</Link>}>
                Las ventas confirmadas aparecen aquí.
              </EmptyState>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">N°</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Vendedor</th>
                  {isAdmin ? <th scope="col">Sucursal</th> : null}
                  <th scope="col">Documento</th>
                  <th scope="col">Pagos</th>
                  <th scope="col" className="num">Pares</th>
                  <th scope="col" className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.rows.map((sale) => (
                  <tr key={sale.id} className={sale.status === "voided" ? "is-muted" : undefined}>
                    <td data-label="N°">
                      <Link className="row-link" href={`/ventas/${sale.id}`}>{saleNumberLabel(sale.saleNumber)}</Link> <StatusBadge status={sale.status} />
                    </td>
                    <td data-label="Fecha" className="num">{formatDateTime(sale.createdAt)}</td>
                    <td data-label="Cliente"><span className="clip-2">{sale.customerName ?? "Sin cliente"}</span></td>
                    <td data-label="Vendedor"><span className="clip-2">{sale.sellerName ?? "—"}</span></td>
                    {isAdmin ? <td data-label="Sucursal">{sale.branchName}</td> : null}
                    <td data-label="Documento"><DocBadge type={sale.docType} channel={sale.channel} /></td>
                    <td data-label="Pagos"><MethodChips methods={sale.methods} /></td>
                    <td data-label="Pares" className="num">{sale.units}</td>
                    <td data-label="Total" className="num"><strong>{formatBs(sale.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={sales}
          basePath="/ventas/historial"
          label="ventas"
          params={{ desde: filters.from, hasta: filters.to, vendedor: filters.sellerId, documento: filters.docType, sucursal: filters.branchId }}
        />
      </section>
    </div>
  );
}
