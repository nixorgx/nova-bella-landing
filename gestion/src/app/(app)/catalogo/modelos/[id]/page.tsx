import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { formatBs } from "@/lib/money";
import { getModel, listAttributes, listModelPairs, listModelVariants } from "@/features/catalog/queries";
import { ActiveToggle } from "@/features/catalog/ui/ActiveToggle";
import { ModelForm } from "@/features/catalog/ui/ModelForm";
import { listModelColors, listModelPhotos } from "@/features/store-admin/queries";
import { ModelStorePanel } from "@/features/store-admin/ui/ModelStorePanel";
import { VariantGenerator } from "@/features/catalog/ui/VariantGenerator";
import { VariantTable } from "@/features/catalog/ui/VariantTable";

export const metadata: Metadata = { title: "Modelo" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ModelPage({ params, searchParams }: Props) {
  const user = await requireRole("superadmin");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const session = toSession(user);
  const model = await getModel(session, id);
  if (!model) notFound();

  const [attributes, variants, existing, photos, modelColors] = await Promise.all([
    listAttributes(session),
    listModelVariants(session, id),
    listModelPairs(session, id),
    listModelPhotos(session, id),
    listModelColors(session, id),
  ]);
  const highlight = typeof query.v === "string" ? query.v : undefined;
  const colors = attributes.colors.filter((color) => color.active);
  const sizes = attributes.sizes.filter((size) => size.active);

  return (
    <div className="page">
      <PageHead eyebrow={`${model.line} · ${formatBs(model.price)}`} title={model.name}>
        <div className="head-actions">
          <span className={`badge ${model.active ? "badge--ok" : "badge--out"}`}>{model.active ? "Activo" : "Inactivo"}</span>
          <Link className="btn" href={`/catalogo/etiquetas?modelo=${model.id}`}>
            Imprimir etiquetas
          </Link>
          <ActiveToggle entity="model" id={model.id} active={model.active} subject={`el modelo ${model.name}`} />
        </div>
      </PageHead>

      <section className="panel" aria-labelledby="gen-title">
        <div className="panel__head">
          <h2 id="gen-title">Generar variantes</h2>
          <span className="eyebrow">Colores × tallas</span>
        </div>
        <div className="panel__body">
          {model.active ? (
            <VariantGenerator modelId={model.id} colors={colors} sizes={sizes} existing={existing} />
          ) : (
            <p className="notice">Active el modelo para generar nuevas variantes.</p>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="variants-title">
        <div className="panel__head">
          <h2 id="variants-title">Variantes</h2>
          <span className="eyebrow">{variants.length} en total</span>
        </div>
        <div className="panel__body">
          <VariantTable variants={variants} highlightId={highlight} />
        </div>
      </section>

      <section className="panel" aria-labelledby="store-title">
        <div className="panel__head">
          <h2 id="store-title">Tienda online</h2>
          <span className="eyebrow">Publicación y fotos</span>
        </div>
        <div className="panel__body">
          <ModelStorePanel modelId={model.id} published={model.publishedOnline} sellable={model.active && model.activeVariants > 0 && Number(model.price) > 0} photos={photos} colors={modelColors} />
        </div>
      </section>

      <section className="panel" aria-labelledby="edit-title">
        <div className="panel__head">
          <h2 id="edit-title">Datos del modelo</h2>
        </div>
        <div className="panel__body">
          <ModelForm lines={attributes.lines} model={model} />
        </div>
      </section>
    </div>
  );
}
