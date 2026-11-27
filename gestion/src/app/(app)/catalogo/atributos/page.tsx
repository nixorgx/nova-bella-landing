import type { Metadata } from "next";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { listAttributes } from "@/features/catalog/queries";
import { ColorsPanel, LinesPanel, SizesPanel } from "@/features/catalog/ui/AttributePanels";

export const metadata: Metadata = { title: "Líneas, colores y tallas" };

export default async function AttributesPage() {
  const user = await requireRole("superadmin");
  const { lines, colors, sizes } = await listAttributes(toSession(user));
  return (
    <div className="page">
      <PageHead
        eyebrow="Catálogo"
        title="Líneas, colores y tallas"
        description="Lo que usa para armar los modelos. Lo que ya tiene variantes se desactiva en lugar de borrarse."
      />
      <div className="attr-layout">
        <LinesPanel lines={lines} />
        <ColorsPanel colors={colors} />
        <SizesPanel sizes={sizes} />
      </div>
    </div>
  );
}
