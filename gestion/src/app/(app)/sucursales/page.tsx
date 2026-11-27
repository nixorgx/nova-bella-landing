import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { uuidParam, type RawSearchParams } from "@/lib/search-params";
import { deactivationBlockers, listBranchSummaries, listSellerAssignments } from "@/features/branches/queries";
import { AssignSellerForm } from "@/features/branches/ui/AssignSellerForm";
import { BranchActiveForm } from "@/features/branches/ui/BranchActiveForm";
import { BranchForm } from "@/features/branches/ui/BranchForm";

export const metadata: Metadata = { title: "Sucursales" };

export default async function BranchesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const params = await searchParams;
  const [branches, sellers] = await Promise.all([listBranchSummaries(session), listSellerAssignments(session)]);
  const editing = branches.find((branch) => branch.id === uuidParam(params.editar));
  const activeOptions = branches.filter((branch) => branch.active).map(({ id, name }) => ({ id, name }));

  return (
    <div className="page page--wide">
      <PageHead
        eyebrow="Administración"
        title="Sucursales"
        description="Cree sucursales, active La Paz cuando abra y asigne a cada vendedor a una sucursal."
      >
        <Link href="/sucursales/transferencias/nueva" className="btn btn--primary">Transferir stock</Link>
      </PageHead>

      <div className="users-layout">
        <div className="stack">
          <section className="panel" aria-labelledby="branches-title">
            <div className="panel__head">
              <h2 id="branches-title">Sucursales</h2>
              <span className="eyebrow">{branches.length} en total</span>
            </div>
            <div className="table-wrap">
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th scope="col">Sucursal</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="num">Vendedores</th>
                    <th scope="col" className="num">Pares en stock</th>
                    <th scope="col"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((branch) => {
                    const blockers = branch.active ? deactivationBlockers(branch) : [];
                    return (
                      <tr key={branch.id} className={branch.active ? undefined : "is-muted"}>
                        <td data-label="Sucursal">
                          <strong>{branch.name}</strong>
                          <br />
                          <span className="is-muted">{branch.city ?? "Sin ciudad"}</span>
                          {blockers.length > 0 ? (
                            <ul className="branch-blockers" id={`blockers-${branch.id}`} aria-label={`Para desactivar ${branch.name}`}>
                              {blockers.map((text) => <li key={text}>{text}</li>)}
                            </ul>
                          ) : null}
                        </td>
                        <td data-label="Estado">
                          <span className={`badge ${branch.active ? "badge--ok" : "badge--out"}`}>{branch.active ? "Activa" : "Inactiva"}</span>
                          {branch.openCash ? <span className="badge badge--low">Caja abierta</span> : null}
                        </td>
                        <td data-label="Vendedores" className="num">{branch.sellers}</td>
                        <td data-label="Pares en stock" className="num">{branch.units}</td>
                        <td data-label="Acciones">
                          <div className="table-actions">
                            <Link className="btn btn--small btn--quiet" href={`/sucursales?editar=${branch.id}`} aria-label={`Editar ${branch.name}`}>Editar</Link>
                            <BranchActiveForm branchId={branch.id} name={branch.name} active={branch.active} blockers={blockers} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" aria-labelledby="assign-title">
            <div className="panel__head">
              <h2 id="assign-title">Vendedores por sucursal</h2>
              <span className="eyebrow">{sellers.length} activos</span>
            </div>
            {sellers.length === 0 ? (
              <div className="panel__body"><p className="is-muted">Todavía no hay vendedores. Créelos en <Link className="row-link" href="/usuarios">Usuarios</Link>.</p></div>
            ) : (
              <div className="table-wrap">
                <table className="table table--stack">
                  <thead>
                    <tr>
                      <th scope="col">Vendedor</th>
                      <th scope="col">Sucursal actual</th>
                      <th scope="col">Cambiar a</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellers.map((seller) => (
                      <tr key={seller.id}>
                        <td data-label="Vendedor"><strong>{seller.username}</strong><br /><span className="is-muted">{seller.fullName}</span></td>
                        <td data-label="Sucursal actual">{seller.branchName ?? "—"}</td>
                        <td data-label="Cambiar a">
                          <AssignSellerForm userId={seller.id} username={seller.username} currentBranchId={seller.branchId} branches={activeOptions} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <section className="panel" aria-labelledby="branch-form-title">
          <div className="panel__head">
            <h2 id="branch-form-title">{editing ? `Editar ${editing.name}` : "Nueva sucursal"}</h2>
            {editing ? <Link className="row-link" href="/sucursales">Cancelar</Link> : null}
          </div>
          <div className="panel__body">
            <BranchForm branch={editing} />
          </div>
        </section>
      </div>
    </div>
  );
}
