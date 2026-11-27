import Link from "next/link";
import type { Role } from "@/lib/auth/session";
import { filterQuery, type ReportFilters } from "../scope";

export interface ReportView {
  readonly id: string;
  readonly label: string;
  readonly roles: readonly Role[];
}

export const REPORT_VIEWS: readonly ReportView[] = [
  { id: "resumen", label: "Resumen", roles: ["superadmin", "seller"] },
  { id: "modelos", label: "Modelos y tallas", roles: ["superadmin", "seller"] },
  { id: "stock", label: "Stock", roles: ["superadmin"] },
  { id: "vendedores", label: "Vendedores y descuentos", roles: ["superadmin"] },
  { id: "cambios", label: "Cambios y anulaciones", roles: ["superadmin", "seller"] },
  { id: "rentabilidad", label: "Costo y utilidad", roles: ["superadmin"] },
];

export function viewsFor(role: Role): readonly ReportView[] {
  return REPORT_VIEWS.filter((view) => view.roles.includes(role));
}

/** Falls back to the summary when the link asks for a view the role cannot open. */
export function pickView(role: Role, requested: string | undefined): ReportView {
  const views = viewsFor(role);
  return views.find((view) => view.id === requested) ?? views[0];
}

export function ReportTabs({ role, current, filters, basePath }: { role: Role; current: string; filters: ReportFilters; basePath: string }) {
  return (
    <nav className="subnav" aria-label="Vistas del reporte">
      {viewsFor(role).map((view) => (
        <Link
          key={view.id}
          href={`${basePath}?${filterQuery(filters, { vista: view.id })}`}
          aria-current={current === view.id ? "page" : undefined}
          className={view.id === "rentabilidad" ? "subnav__cost" : undefined}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
