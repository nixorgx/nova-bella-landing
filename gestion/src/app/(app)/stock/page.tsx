import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/PageHead";
import { Pagination } from "@/components/ui/Pagination";
import { requireRole, toSession, type AuthUser } from "@/lib/auth/guards";
import { formatBs } from "@/lib/money";
import { parsePageRequest } from "@/lib/pagination";
import { uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions } from "@/features/branches/queries";
import { listStock, stockState } from "@/features/stock/queries";
import { getStockMatrix } from "@/features/stock/matrix";
import { inventoryValue, StockMatrixView } from "@/features/stock/ui/StockMatrixView";

export const metadata: Metadata = { title: "Stock" };

const STATE_LABEL = { ok: "Disponible", low: "Stock bajo", out: "Agotado" } as const;
type SearchParams = Promise<RawSearchParams>;

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireRole("superadmin", "seller");
  const params = await searchParams;
  return user.role === "superadmin" ? <AdminStock user={user} params={params} /> : <SellerStock user={user} params={params} />;
}

async function AdminStock({ user, params }: { user: AuthUser; params: RawSearchParams }) {
  const session = toSession(user);
  const branchId = uuidParam(params.sucursal);
  const modelId = uuidParam(params.modelo);
  const [branches, all] = await Promise.all([listBranchOptions(session, { includeInactive: true }), getStockMatrix(session, { branchId })]);
  const shown = modelId ? all.filter((model) => model.modelId === modelId) : all;
  const units = shown.reduce((sum, model) => sum + model.units, 0);
  const branchName = branches.find((b) => b.id === branchId)?.name;

  return (
    <div className="page page--wide">
      <PageHead eyebrow={branchName ?? "Todas las sucursales"} title="Stock" description="Existencias por modelo, color y talla. El costo (en azul) solo lo ve el superadmin." />
      <form method="get" action="/stock" className="filters filters--stock" role="search" aria-label="Filtrar stock">
        <div className="field">
          <label className="field__label" htmlFor="s-sucursal">Sucursal</label>
          <select id="s-sucursal" name="sucursal" className="field__control" defaultValue={branchId ?? ""}>
            <option value="">Todas</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="s-modelo">Modelo</label>
          <select id="s-modelo" name="modelo" className="field__control" defaultValue={modelId ?? ""}>
            <option value="">Todos</option>
            {all.map((m) => <option key={m.modelId} value={m.modelId}>{m.model}</option>)}
          </select>
        </div>
        <div className="filters__buttons">
          <button type="submit" className="btn">Filtrar</button>
          <Link href="/stock" className="btn btn--quiet">Limpiar</Link>
        </div>
      </form>
      <ul className="stats__tiles stats__tiles--3" aria-label="Resumen de stock">
        <li className="tile"><span className="tile__label">Pares en stock</span><strong className="tile__value num">{units}</strong><span className="tile__note">{shown.length} modelos</span></li>
        <li className="tile tile--cost"><span className="tile__label">Valor a costo promedio</span><strong className="tile__value num cost">{formatBs(inventoryValue(shown))}</strong><span className="tile__note">solo superadmin</span></li>
        <li className="tile"><span className="tile__label">Variantes agotadas</span><strong className="tile__value num">{shown.reduce((n, m) => n + Object.values(m.cells).filter((c) => c.qty === 0).length, 0)}</strong><span className="tile__note">en rojo en la matriz</span></li>
      </ul>
      <StockMatrixView models={shown} />
    </div>
  );
}

async function SellerStock({ user, params }: { user: AuthUser; params: RawSearchParams }) {
  const stock = await listStock(user, parsePageRequest(params));
  const rows = stock.rows;
  return (
    <div className="page">
      <PageHead eyebrow={user.branchName ?? "Todas las sucursales"} title="Stock" description="Existencias por modelo, color y talla." />
      <section className="panel" aria-label="Existencias">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Modelo</th>
                <th scope="col">Color</th>
                <th scope="col" className="num">Talla</th>
                <th scope="col" className="num">Cant.</th>
                <th scope="col" className="num">Precio</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="is-muted">Todavía no hay existencias registradas.</td></tr>
              ) : (
                rows.map((row) => {
                  const state = stockState(row.qty);
                  return (
                    <tr key={row.sku}>
                      <td className="num">{row.sku}</td>
                      <td>{row.model}</td>
                      <td>{row.color}</td>
                      <td className="num">{row.size}</td>
                      <td className="num">{row.qty}</td>
                      <td className="num">{formatBs(row.price)}</td>
                      <td><span className={`badge badge--${state}`}>{STATE_LABEL[state]}</span></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={stock} basePath="/stock" label="existencias" />
      </section>
    </div>
  );
}
