import Link from "next/link";
import { filtersToQuery, SORT_LABEL, SORTS, type CatalogFilters, type Facets } from "../catalog-filter";

function Chip({ name, value, checked, children }: { name: string; value: string; checked: boolean; children: React.ReactNode }) {
  return (
    <label className="schip">
      <input type="radio" name={name} value={value} defaultChecked={checked} />
      <span>{children}</span>
    </label>
  );
}

function activeChips(filters: CatalogFilters, facets: Facets): { label: string; href: string }[] {
  const chips: { label: string; href: string }[] = [];
  const without = (key: string) => `/tienda${filtersToQuery(filters, { [key]: undefined, pagina: undefined })}`;
  if (filters.q) chips.push({ label: `“${filters.q}”`, href: without("q") });
  const line = facets.lines.find((l) => l.id === filters.lineId);
  if (line) chips.push({ label: line.name, href: without("linea") });
  const color = facets.colors.find((c) => c.id === filters.colorId);
  if (color) chips.push({ label: color.name, href: without("color") });
  const size = facets.sizes.find((s) => s.id === filters.sizeId);
  if (size) chips.push({ label: `Talla ${size.label}`, href: without("talla") });
  if (filters.min !== undefined) chips.push({ label: `Desde Bs ${filters.min}`, href: without("min") });
  if (filters.max !== undefined) chips.push({ label: `Hasta Bs ${filters.max}`, href: without("max") });
  return chips;
}

/** Server-rendered GET form: filters live in the URL (shareable) and need no JavaScript. */
export function FilterBar({ filters, facets, total }: { filters: CatalogFilters; facets: Facets; total: number }) {
  const chips = activeChips(filters, facets);
  return (
    <section className="sfilters" aria-label="Buscar y filtrar">
      <form method="get" action="/tienda" role="search" className="sfilters__form">
        <div className="sfilters__top">
          <div className="field sfilters__search">
            <label className="field__label" htmlFor="f-q">
              Buscar
            </label>
            <input id="f-q" className="field__control" type="search" name="q" defaultValue={filters.q ?? ""} placeholder="Modelo, color…" maxLength={60} autoComplete="off" enterKeyHint="search" />
          </div>
          <button className="btn btn--primary sfilters__go" type="submit">
            Buscar
          </button>
        </div>
        <details className="sfilters__more" open={chips.some((c) => !c.label.startsWith("“")) || undefined}>
          <summary className="btn btn--small">Filtros y orden</summary>
          <div className="sfilters__panel">
            {facets.lines.length > 1 ? (
              <fieldset className="schips">
                <legend>Línea</legend>
                <Chip name="linea" value="" checked={!filters.lineId}>Todas</Chip>
                {facets.lines.map((line) => (
                  <Chip key={line.id} name="linea" value={line.id} checked={filters.lineId === line.id}>{line.name}</Chip>
                ))}
              </fieldset>
            ) : null}
            {facets.colors.length > 0 ? (
              <fieldset className="schips">
                <legend>Color</legend>
                <Chip name="color" value="" checked={!filters.colorId}>Todos</Chip>
                {facets.colors.map((color) => (
                  <Chip key={color.id} name="color" value={color.id} checked={filters.colorId === color.id}>
                    <i className="sswatch" style={color.hex ? { background: color.hex } : undefined} aria-hidden="true" />
                    {color.name}
                  </Chip>
                ))}
              </fieldset>
            ) : null}
            {facets.sizes.length > 0 ? (
              <fieldset className="schips schips--sizes">
                <legend>Talla</legend>
                <Chip name="talla" value="" checked={!filters.sizeId}>Todas</Chip>
                {facets.sizes.map((size) => (
                  <Chip key={size.id} name="talla" value={size.id} checked={filters.sizeId === size.id}>{size.label}</Chip>
                ))}
              </fieldset>
            ) : null}
            <fieldset className="sfilters__price">
              <legend>Precio (Bs)</legend>
              <div className="field">
                <label className="field__label" htmlFor="f-min">Desde</label>
                <input id="f-min" className="field__control" type="number" name="min" inputMode="numeric" min={0} max={999999} defaultValue={filters.min ?? ""} placeholder={String(Math.floor(facets.priceMin))} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="f-max">Hasta</label>
                <input id="f-max" className="field__control" type="number" name="max" inputMode="numeric" min={0} max={999999} defaultValue={filters.max ?? ""} placeholder={String(Math.ceil(facets.priceMax))} />
              </div>
            </fieldset>
            <div className="field">
              <label className="field__label" htmlFor="f-orden">Ordenar por</label>
              <select id="f-orden" className="field__control" name="orden" defaultValue={filters.sort}>
                {SORTS.map((sort) => (
                  <option key={sort} value={sort}>{SORT_LABEL[sort]}</option>
                ))}
              </select>
            </div>
            <div className="sfilters__buttons">
              <button className="btn btn--primary" type="submit">Aplicar filtros</button>
              <Link className="btn btn--quiet" href="/tienda">Limpiar</Link>
            </div>
          </div>
        </details>
      </form>
      <p className="sfilters__count" role="status">
        {total === 1 ? "1 modelo" : `${total} modelos`}
      </p>
      {chips.length > 0 ? (
        <ul className="sfilters__active" aria-label="Filtros activos">
          {chips.map((chip) => (
            <li key={chip.label}>
              <Link className="tag" href={chip.href} aria-label={`Quitar filtro ${chip.label}`}>
                {chip.label} <span aria-hidden="true">×</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
