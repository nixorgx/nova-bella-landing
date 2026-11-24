import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import type { RawSearchParams } from "@/lib/search-params";
import { applyFilters, buildFacets, filtersToQuery, hasActiveFilters, parseFilters } from "@/features/store/catalog-filter";
import { getCatalog, getStoreInfo } from "@/features/store/public-data";
import { FilterBar } from "@/features/store/ui/FilterBar";
import { ProductCard } from "@/features/store/ui/ProductCard";
import { PurchaseInfo } from "@/features/store/ui/PurchaseInfo";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const filters = parseFilters(await searchParams);
  const filtered = hasActiveFilters(filters) || filters.page > 1 || filters.sort !== "destacados";
  return {
    title: "Catálogo",
    alternates: { canonical: "/tienda" },
    // Filtered views are for people, not for search engines: only the clean catalog is indexed.
    robots: filtered ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: { title: "NovaBella · Calzado", url: "/tienda" },
  };
}

export default async function StoreHome({ searchParams }: Props) {
  const filters = parseFilters(await searchParams);
  const [catalog, info] = await Promise.all([getCatalog(), getStoreInfo()]);
  const facets = buildFacets(catalog);
  const result = applyFilters(catalog, filters);
  const filtered = hasActiveFilters(filters);

  return (
    <>
      <section className="store-intro" aria-labelledby="catalogo-title">
        <p className="eyebrow">Calzado · NovaBella</p>
        <h1 id="catalogo-title">
          Pasos con <em>carácter</em>
        </h1>
      </section>

      <FilterBar filters={filters} facets={facets} total={result.total} />

      {result.items.length === 0 ? (
        <EmptyState
          title={filtered ? "Ningún modelo coincide" : "Muy pronto, nuevos modelos"}
          action={filtered ? <Link className="btn btn--small" href="/tienda">Quitar filtros</Link> : undefined}
        >
          {filtered ? "Pruebe con otro color, talla o rango de precio." : "Estamos preparando el catálogo. Vuelva en unos días."}
        </EmptyState>
      ) : (
        <ul className="pgrid" aria-label="Modelos">
          {result.items.map((model, index) => (
            <ProductCard key={model.id} model={model} featured={index === 0 && result.page === 1 && result.items.length > 3} priority={index === 0} />
          ))}
        </ul>
      )}

      {result.pageCount > 1 ? (
        <nav className="store-pager" aria-label="Páginas del catálogo">
          {result.page > 1 ? (
            <Link className="btn btn--quiet" href={`/tienda${filtersToQuery(filters, { pagina: result.page > 2 ? String(result.page - 1) : undefined })}`} rel="prev">
              Anterior
            </Link>
          ) : null}
          <span className="num">
            Página {result.page} de {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link className="btn btn--quiet" href={`/tienda${filtersToQuery(filters, { pagina: String(result.page + 1) })}`} rel="next">
              Siguiente
            </Link>
          ) : null}
        </nav>
      ) : null}

      <PurchaseInfo info={info} />
    </>
  );
}
