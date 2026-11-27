import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { getCatalogSummary, listAttributes, listModels, type StatusFilter } from "@/features/catalog/queries";
import { CatalogLookup } from "@/features/catalog/ui/CatalogLookup";
import { ModelFiltersForm, ModelsTable } from "@/features/catalog/ui/ModelsTable";
import { BulkPublishBar } from "@/features/store-admin/ui/BulkPublishBar";
import { StatTiles } from "@/features/catalog/ui/StatTiles";

export const metadata: Metadata = { title: "Catálogo" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim() : undefined;
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireRole("superadmin");
  const params = await searchParams;
  const session = toSession(user);
  const lineId = one(params.linea);
  const estado = one(params.estado);
  const status: StatusFilter = estado === "active" || estado === "inactive" ? estado : "all";
  const filters = { lineId: lineId && /^[0-9a-f-]{36}$/i.test(lineId) ? lineId : undefined, status, q: one(params.q) };

  const [summary, attributes, models] = await Promise.all([
    getCatalogSummary(session),
    listAttributes(session),
    listModels(session, filters),
  ]);
  const filtered = Boolean(filters.lineId || filters.q || status !== "all");

  return (
    <div className="page">
      <PageHead eyebrow="Productos" title="Catálogo" description="Modelos, colores, tallas y códigos de cada par.">
        <Link href="/catalogo/modelos/nuevo" className="btn btn--primary">
          Nuevo modelo
        </Link>
      </PageHead>
      <StatTiles summary={summary} />
      <section className="panel lookup" aria-label="Buscar variante">
        <div className="panel__body">
          <CatalogLookup />
        </div>
      </section>
      <section className="panel" aria-labelledby="models-title">
        <div className="panel__head">
          <h2 id="models-title">Modelos</h2>
          <span className="eyebrow">{models.length} {filtered ? "resultados" : "en total"}</span>
        </div>
        <div className="panel__body stack">
          <ModelFiltersForm lines={attributes.lines} filters={filters} />
          <BulkPublishBar ready={models.filter((m) => !m.publishedOnline && m.active && m.activeVariants > 0 && Number(m.price) > 0).length} />
          <ModelsTable models={models} filtered={filtered} />
        </div>
      </section>
    </div>
  );
}
