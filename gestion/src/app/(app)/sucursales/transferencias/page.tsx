import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Pagination } from "@/components/ui/Pagination";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { parsePageRequest } from "@/lib/pagination";
import { dateParam, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions } from "@/features/branches/queries";
import { listTransfers, type TransferFilters } from "@/features/transfers/queries";

export const metadata: Metadata = { title: "Transferencias" };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const params = await searchParams;
  const filters: TransferFilters = {
    from: dateParam(params.desde),
    to: dateParam(params.hasta),
    branchId: uuidParam(params.sucursal),
  };
  const [transfers, branches] = await Promise.all([
    listTransfers(session, filters, parsePageRequest(params)),
    listBranchOptions(session, { includeInactive: true }),
  ]);
  const filtered = Boolean(filters.from || filters.to || filters.branchId);

  return (
    <div className="page page--wide">
      <PageHead eyebrow="Sucursales" title="Transferencias" description="Historial de stock movido entre sucursales.">
        <Link href="/sucursales/transferencias/nueva" className="btn btn--primary">Nueva transferencia</Link>
      </PageHead>
      <section className="panel" aria-labelledby="transfers-title">
        <div className="panel__head">
          <h2 id="transfers-title">Historial</h2>
          <span className="eyebrow">{transfers.total} {transfers.total === 1 ? "resultado" : "resultados"}</span>
        </div>
        <div className="panel__body">
          <form method="get" action="/sucursales/transferencias" className="filters filters--stock" role="search" aria-label="Filtrar transferencias">
            <div className="field">
              <label className="field__label" htmlFor="t-desde">Desde</label>
              <input id="t-desde" name="desde" type="date" className="field__control" defaultValue={filters.from ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="t-hasta">Hasta</label>
              <input id="t-hasta" name="hasta" type="date" className="field__control" defaultValue={filters.to ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="t-sucursal">Sucursal (origen o destino)</label>
              <select id="t-sucursal" name="sucursal" className="field__control" defaultValue={filters.branchId ?? ""}>
                <option value="">Todas</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="filters__buttons">
              <button type="submit" className="btn">Filtrar</button>
              <Link href="/sucursales/transferencias" className="btn btn--quiet">Limpiar</Link>
            </div>
          </form>
        </div>
        {transfers.rows.length === 0 ? (
          <div className="panel__body">
            <EmptyState
              title={filtered ? "Ninguna transferencia coincide" : "Todavía no hay transferencias"}
              action={<Link href={filtered ? "/sucursales/transferencias" : "/sucursales/transferencias/nueva"} className="btn btn--small">{filtered ? "Quitar filtros" : "Hacer la primera"}</Link>}
            >
              {filtered ? "Pruebe con otro rango de fechas o sucursal." : "Cuando mueva stock entre sucursales quedará registrado aquí."}
            </EmptyState>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th scope="col">N°</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">De</th>
                  <th scope="col">A</th>
                  <th scope="col" className="num">Productos</th>
                  <th scope="col" className="num">Pares</th>
                  <th scope="col">Registró</th>
                </tr>
              </thead>
              <tbody>
                {transfers.rows.map((t) => (
                  <tr key={t.id}>
                    <td data-label="N°"><Link className="row-link" href={`/sucursales/transferencias/${t.id}`}>T-{String(t.number).padStart(4, "0")}</Link></td>
                    <td data-label="Fecha" className="num">{formatDateTime(t.createdAt)}</td>
                    <td data-label="De">{t.fromName}</td>
                    <td data-label="A">{t.toName}</td>
                    <td data-label="Productos" className="num">{t.products}</td>
                    <td data-label="Pares" className="num">{t.units}</td>
                    <td data-label="Registró"><span className="clip-2">{t.byName ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={transfers} basePath="/sucursales/transferencias" label="transferencias" params={{ desde: filters.from, hasta: filters.to, sucursal: filters.branchId }} />
      </section>
    </div>
  );
}
