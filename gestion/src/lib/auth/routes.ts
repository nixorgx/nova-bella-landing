import type { Role } from "./session";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly roles: readonly Role[];
}

/** Single source of truth for navigation and route access (proxy + shell). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["superadmin"] },
  { href: "/catalogo", label: "Catálogo", roles: ["superadmin"] },
  { href: "/compras", label: "Compras", roles: ["superadmin"] },
  { href: "/ventas", label: "Ventas", roles: ["superadmin", "seller"] },
  { href: "/pedidos", label: "Pedidos web", roles: ["superadmin", "seller"] },
  { href: "/clientes", label: "Clientes", roles: ["superadmin", "seller"] },
  { href: "/stock", label: "Stock", roles: ["superadmin", "seller"] },
  { href: "/cajas", label: "Cajas", roles: ["superadmin"] },
  { href: "/reportes", label: "Reportes", roles: ["superadmin", "seller"] },
  { href: "/sucursales", label: "Sucursales", roles: ["superadmin"] },
  { href: "/tienda-online", label: "Tienda online", roles: ["superadmin"] },
  { href: "/usuarios", label: "Usuarios", roles: ["superadmin"] },
];

export const LOGIN_PATH = "/login";
/** Public storefront. Everything under it is anonymous; sitemap.xml and robots.txt too. */
export const STORE_PATH = "/tienda";

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/public/products" ||
    pathname === "/api/v1/public/health" ||
    pathname === STORE_PATH ||
    pathname.startsWith(`${STORE_PATH}/`) ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt"
  );
}
/** Route handler that clears a dead session cookie and then sends the user to the login. */
/** Self-service password change (any signed-in user; forced after a superadmin reset). */
export const CHANGE_PASSWORD_PATH = "/cuenta/contrasena";
export const SESSION_RESET_PATH = "/api/sesion/reiniciar";

export function homeFor(role: Role): string {
  return role === "superadmin" ? "/dashboard" : "/ventas";
}

export function navFor(role: Role): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Optimistic route check. The database (RLS) remains the real authority. */
export function canAccess(role: Role, pathname: string): boolean {
  const item = NAV_ITEMS.find((entry) => matches(pathname, entry.href));
  return item ? item.roles.includes(role) : true;
}
