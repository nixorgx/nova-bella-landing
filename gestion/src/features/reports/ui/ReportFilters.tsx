import Link from "next/link";
import type { BranchOption } from "@/features/branches/queries";
import type { SellerOption } from "@/features/sales/queries";
import type { PeriodKind } from "../period";
import { filterQuery, type ReportFilters as Filters } from "../scope";

const PRESETS: readonly { kind: PeriodKind; label: string }[] = [
  { kind: "hoy", label: "Hoy" },
  { kind: "semana", label: "Esta semana" },
  { kind: "mes", label: "Este mes" },
];

interface Props {
  readonly basePath: string;
  readonly filters: Filters;
  readonly view?: string;
  readonly branches?: readonly BranchOption[];
  readonly sellers?: readonly SellerOption[];
}

/**
 * One row above the report: period presets (links), custom range, branch and seller. Everything is a
 * plain GET so any view can be shared as a URL.
 */
export function ReportFilters({ basePath, filters, view, branches, sellers }: Props) {
  const withKind = (kind: PeriodKind): string =>
    `${basePath}?${filterQuery({ ...filters, period: { ...filters.period, kind } }, { vista: view })}`;
  const custom = filters.period.kind === "rango";
  return (
    <section className="rfilters" aria-label="Filtros del reporte">
      <nav className="presets" aria-label="Período">
        {PRESETS.map((preset) => (
          <Link key={preset.kind} href={withKind(preset.kind)} aria-current={filters.period.kind === preset.kind ? "true" : undefined}>
            {preset.label}
          </Link>
        ))}
        <span className="presets__custom" aria-current={custom ? "true" : undefined}>Rango</span>
      </nav>
      <form method="get" action={basePath} className="rfilters__form" aria-label="Rango personalizado y sucursal">
        {view ? <input type="hidden" name="vista" value={view} /> : null}
        <input type="hidden" name="periodo" value="rango" />
        <div className="field">
          <label className="field__label" htmlFor="r-desde">Desde</label>
          <input id="r-desde" name="desde" type="date" className="field__control" defaultValue={filters.period.from} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="r-hasta">Hasta</label>
          <input id="r-hasta" name="hasta" type="date" className="field__control" defaultValue={filters.period.to} />
        </div>
        {branches && branches.length > 1 ? (
          <div className="field">
            <label className="field__label" htmlFor="r-sucursal">Sucursal</label>
            <select id="r-sucursal" name="sucursal" className="field__control" defaultValue={filters.branchId ?? ""}>
              <option value="">Todas</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        ) : null}
        {sellers && sellers.length > 0 ? (
          <div className="field">
            <label className="field__label" htmlFor="r-vendedor">Vendedor</label>
            <select id="r-vendedor" name="vendedor" className="field__control" defaultValue={filters.sellerId ?? ""}>
              <option value="">Todos</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor="r-canal">Canal</label>
          <select id="r-canal" name="canal" className="field__control" defaultValue={filters.channel === "web" ? "web" : filters.channel === "store" ? "tienda" : ""}>
            <option value="">Todos</option>
            <option value="tienda">Tienda física</option>
            <option value="web">Tienda web</option>
          </select>
        </div>
        <button type="submit" className="btn">Aplicar</button>
      </form>
      <p className="rfilters__now">
        <strong>{filters.period.label}</strong>
        <span className="num">{filters.period.from === filters.period.to ? filters.period.from : `${filters.period.from} → ${filters.period.to}`}</span>
      </p>
    </section>
  );
}
