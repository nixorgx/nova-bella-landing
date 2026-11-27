import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { listModels, listModelVariants } from "@/features/catalog/queries";
import { LabelStudio } from "@/features/catalog/ui/LabelStudio";

export const metadata: Metadata = { title: "Etiquetas" };

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("superadmin");
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const session = toSession(user);
  const params = await searchParams;
  const requested = typeof params.modelo === "string" && /^[0-9a-f-]{36}$/i.test(params.modelo) ? params.modelo : undefined;

  const [models, variants] = await Promise.all([
    listModels(session, { status: "active" }),
    requested ? listModelVariants(session, requested) : Promise.resolve([]),
  ]);
  const initialItems = variants
    .filter((variant) => variant.active)
    .map((variant) => ({
      variantId: variant.variantId,
      sku: variant.sku,
      barcode: variant.barcode,
      model: variant.model,
      color: variant.color,
      size: variant.size,
      price: variant.price,
      stock: variant.stock,
      qty: 1,
    }));

  return (
    <div className="page page--wide">
      <PageHead
        className="no-print"
        eyebrow="Catálogo"
        title="Etiquetas"
        description="QR con el SKU y código de barras Code 128, listos para imprimir en rollo o en hoja A4."
      />
      <LabelStudio
        models={models.map((model) => ({ id: model.id, name: model.name, line: model.line }))}
        initialItems={initialItems}
        initialModelId={requested}
        nonce={nonce}
      />
    </div>
  );
}
