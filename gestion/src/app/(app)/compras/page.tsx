import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHead } from "@/components/ui/PageHead";
import { Pagination } from "@/components/ui/Pagination";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatPlainDate } from "@/lib/format";
import { formatBs } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { dateParam, one, uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions } from "@/features/branches/queries";
import { listBatches, listSuppliers, type BatchFilters } from "@/features/purchases/batches";

export const metadata: Metadata = { title: "Compras" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const params = await searchParams;
  const filters: BatchFilters = {
    from: dateParam(params.desde),
    to: dateParam(params.hasta),
    branchId: uuidParam(params.sucursal),
    supplier: one(params.proveedor)?.slice(0, 80),
  };
  const [batches, branches, suppliers] = await Promise.all([
    listBatches(session, filters, parsePageRequest(params)),
    listBranchOptions(session, { includeInactive: true }),
    listSuppliers(session),
  ]);
  const filtered = Boolean(filters.from || filters.to || filters.branchId || filters.supplier);

  return (
    <div className="page">
      <PageHead eyebrow="Ingreso de mercadería" title="Lotes de compra" description="Cada lote guarda su tipo de cambio y flete: el costo histórico nunca se recalcula.">
        <Link href="/compras/nuevo" className="btn btn--primary">Nuevo lote</Link>
      </PageHead>

      <section className="panel panel--cost" aria-labelledby="batches-title">
        <div className="panel__head">
          <h2 id="batches-title">Historial</h2>
          <span className="cost-tag">Costo · solo superadmin</span>
        </div>
        <div className="panel__body">
          <form method="get" action="/compras" className="filters filters--5" role="search" aria-label="Filtrar lotes">
            <div className="field">
              <label className="field__label" htmlFor="f-desde">Desde</label>
              <input id="f-desde" name="desde" type="date" className="field__control" defaultValue={filters.from ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-hasta">Hasta</label>
              <input id="f-hasta" name="hasta" type="date" className="field__control" defaultValue={filters.to ?? ""} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-sucursal">Sucursal</label>
              <select id="f-sucursal" name="sucursal" className="field__control" defaultValue={filters.branchId ?? ""}>
                <option value="">Todas</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-proveedor">Proveedor</label>
              <input id="f-proveedor" name="proveedor" className="field__control" list="f-suppliers" defaultValue={filters.supplier ?? ""} autoComplete="off" />
              <datalist id="f-suppliers">
                {suppliers.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="filters__buttons">
              <button type="submit" className="btn">Filtrar</button>
              <Link href="/compras" className="btn btn--quiet">Limpiar</Link>
            </div>
          </form>
        </div>

        {batches.rows.length === 0 ? (
          <div className="panel__body">
            {filtered ? (
              <EmptyState title="Ningún lote coincide" action={<Link href="/compras" className="btn btn--small">Quitar filtros</Link>}>
                Pruebe con otro rango de fechas o proveedor.
              </EmptyState>
            ) : (
              <EmptyState title="Todavía no hay lotes" action={<Link href="/compras/nuevo" className="btn btn--primary btn--small">Registrar el primer lote</Link>}>
                Un lote es una compra de mercadería: sube el stock y fija el costo de cada variante.
              </EmptyState>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table table--stack table--cost">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Sucursal</th>
                  <th scope="col" className="num">Productos</th>
                  <th scope="col" className="num">Unidades</th>
                  <th scope="col" className="num">Flete</th>
                  <th scope="col" className="num">Costo total</th>
                </tr>
              </thead>
              <tbody>
                {batches.rows.map((batch) => (
                  <tr key={batch.id}>
                    <td data-label="Fecha">
                      <Link className="row-link" href={`/compras/${batch.id}`}>{formatPlainDate(batch.batchDate)}</Link>
                    </td>
                    <td data-label="Proveedor"><span className="clip-2">{batch.supplier ?? "—"}</span></td>
                    <td data-label="Sucursal">{batch.branchName}</td>
                    <td data-label="Productos" className="num">{batch.products}</td>
                    <td data-label="Unidades" className="num">{batch.units}</td>
                    <td data-label="Flete" className="num">{formatBs(batch.freightBs)}</td>
                    <td data-label="Costo total" className="num cost"><strong>{formatBs(batch.totalBs)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={batches}
          basePath="/compras"
          label="lotes"
          params={{ desde: filters.from, hasta: filters.to, sucursal: filters.branchId, proveedor: filters.supplier }}
        />
      </section>
    </div>
  );
}
