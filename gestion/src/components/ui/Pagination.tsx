import Link from "next/link";
import type { Page } from "@/lib/pagination";

function pageHref(
  basePath: string,
  page: number,
  pageSize: number,
  extra: Readonly<Record<string, string | undefined>>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  params.set("pagina", String(page));
  if (pageSize !== 50) params.set("tamano", String(pageSize));
  return `${basePath}?${params.toString()}`;
}

/** "Mostrando 11–20 de 83" with previous / next links; shows the real total, never a silent cut. */
export function Pagination({
  page,
  basePath,
  label,
  params = {},
}: {
  page: Page<unknown>;
  basePath: string;
  label: string;
  /** Active filters, kept in every link. */
  params?: Readonly<Record<string, string | undefined>>;
}) {
  const { total, from, to, pageCount, pageSize } = page;
  const prev = page.page > 1 ? pageHref(basePath, page.page - 1, pageSize, params) : null;
  const next = page.page < pageCount ? pageHref(basePath, page.page + 1, pageSize, params) : null;
  return (
    <nav className="pager" aria-label={`Paginación de ${label}`}>
      <p className="pager__status" role="status">
        {total === 0 ? "Sin resultados" : `Mostrando ${from}–${to} de ${total}`}
      </p>
      <div className="pager__links">
        {prev ? (
          <Link className="btn btn--quiet btn--small" href={prev} rel="prev">
            Anterior
          </Link>
        ) : (
          <span className="btn btn--quiet btn--small" aria-disabled="true">Anterior</span>
        )}
        <span className="pager__page">
          Página {page.page} de {pageCount}
        </span>
        {next ? (
          <Link className="btn btn--quiet btn--small" href={next} rel="next">
            Siguiente
          </Link>
        ) : (
          <span className="btn btn--quiet btn--small" aria-disabled="true">Siguiente</span>
        )}
      </div>
    </nav>
  );
}
