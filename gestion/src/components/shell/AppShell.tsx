import Link from "next/link";
import { requireSessionUser, toSession } from "@/lib/auth/guards";
import { countOpenOrders } from "@/features/orders/queries";
import { CHANGE_PASSWORD_PATH, navFor } from "@/lib/auth/routes";
import { logoutAction } from "@/features/auth/actions";
import { BrandMark } from "@/components/ui/BrandMark";
import { NavLinks } from "./NavLinks";

const ROLE_LABEL = { superadmin: "Superadmin", seller: "Vendedor" } as const;

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  // While a temporary password is pending nothing else works, so no menu is offered.
  // New-orders badge (superadmin: payments to review; seller: confirmed orders to dispatch). Never blocks the page.
  const open = user.mustChangePassword ? 0 : await countOpenOrders(toSession(user)).catch(() => 0);
  const items = (user.mustChangePassword ? [] : navFor(user.role)).map(({ href, label }) => ({
    href,
    label,
    badge: href === "/pedidos" ? open : undefined,
  }));

  return (
    <div className="shell">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="shell__rail">
        <div className="shell__top">
          <p className="brand">
            <BrandMark className="brand__mark" />
            <span className="brand__text">
              <span className="brand__word">
                Nova<em>Bella</em>
              </span>
              <small>Inventario y ventas</small>
            </span>
          </p>
          <div className="account">
            <Link className="account__me" href={CHANGE_PASSWORD_PATH}>
              <span className="account__avatar" aria-hidden="true">
                {user.fullName.trim().charAt(0).toUpperCase()}
              </span>
              <span className="account__who">
                <strong>{user.fullName}</strong>
                <span>
                  {ROLE_LABEL[user.role]}
                  {user.branchName ? ` · ${user.branchName}` : ""}
                </span>
                <small className="account__hint">Cambiar contraseña</small>
              </span>
            </Link>
            <form action={logoutAction}>
              <button className="btn btn--small" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>
        {items.length > 0 ? <NavLinks items={items} /> : null}
      </header>
      <main id="contenido" className="shell__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
