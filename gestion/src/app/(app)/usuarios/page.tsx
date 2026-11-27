import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole } from "@/lib/auth/guards";
import { CreateSellerForm } from "@/features/users/CreateSellerForm";
import { setUserActiveAction } from "@/features/users/actions";
import { listActiveBranches, listUsers } from "@/features/users/queries";

export const metadata: Metadata = { title: "Usuarios" };

const dateFormat = new Intl.DateTimeFormat("es-BO", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/La_Paz",
});

export default async function UsersPage() {
  const actor = await requireRole("superadmin");
  const [users, branches] = await Promise.all([listUsers(actor), listActiveBranches(actor)]);

  return (
    <div className="page">
      <PageHead eyebrow="Administración" title="Usuarios" description="Cree vendedores y desactive el acceso cuando ya no trabajen en la tienda." />
      <div className="users-layout">
        <section className="panel" aria-labelledby="users-title">
          <div className="panel__head">
            <h2 id="users-title">Cuentas</h2>
            <span className="eyebrow">{users.length} en total</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Usuario</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Sucursal</th>
                  <th scope="col">Último ingreso</th>
                  <th scope="col">Contraseña</th>
                  <th scope="col">Estado</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.active ? undefined : "is-muted"}>
                    <td>
                      <strong>{user.username}</strong>
                      <br />
                      <span className="is-muted">{user.fullName}</span>
                    </td>
                    <td>{user.role === "superadmin" ? "Superadmin" : "Vendedor"}</td>
                    <td>{user.branchName ?? "Todas"}</td>
                    <td className="num">{user.lastLoginAt ? dateFormat.format(new Date(user.lastLoginAt)) : "Nunca"}</td>
                    <td>
                      {user.mustChangePassword ? (
                        <span className="badge badge--low">Cambiar al ingresar</span>
                      ) : user.passwordChangedAt ? (
                        <span className="is-muted">Cambiada {dateFormat.format(new Date(user.passwordChangedAt))}</span>
                      ) : (
                        <span className="is-muted">Original</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${user.active ? "badge--ok" : "badge--out"}`}>
                        {user.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td>
                      {user.id !== actor.id ? (
                        <div className="table-actions">
                          <Link className="btn btn--small" href={`/usuarios/${user.id}/contrasena`}>
                            Restablecer<span className="sr-only"> contraseña de {user.username}</span>
                          </Link>
                          {user.role === "seller" ? (
                            <form action={setUserActiveAction} className="inline-form">
                              <input type="hidden" name="userId" value={user.id} />
                              <input type="hidden" name="active" value={String(!user.active)} />
                              <button className={`btn btn--small ${user.active ? "btn--danger" : ""}`} type="submit">
                                {user.active ? "Desactivar" : "Reactivar"}
                              </button>
                            </form>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel" aria-labelledby="new-seller-title">
          <div className="panel__head">
            <h2 id="new-seller-title">Nuevo vendedor</h2>
          </div>
          <div className="panel__body">
            <CreateSellerForm branches={branches} />
          </div>
        </section>
      </div>
    </div>
  );
}
