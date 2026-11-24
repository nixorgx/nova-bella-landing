import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/PageHead";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireRole, toSession } from "@/lib/auth/guards";
import { listAttributes } from "@/features/catalog/queries";
import { ModelForm } from "@/features/catalog/ui/ModelForm";

export const metadata: Metadata = { title: "Nuevo modelo" };

export default async function NewModelPage() {
  const user = await requireRole("superadmin");
  const { lines } = await listAttributes(toSession(user));
  const hasLines = lines.some((line) => line.active);

  return (
    <div className="page page--narrow">
      <PageHead eyebrow="Catálogo" title="Nuevo modelo" description="Primero el modelo; los colores y tallas se generan después." />
      <section className="panel" aria-label="Datos del modelo">
        <div className="panel__body">
          {hasLines ? (
            <ModelForm lines={lines} />
          ) : (
            <EmptyState title="Primero cree una línea" action={<Link className="btn btn--small" href="/catalogo/atributos">Crear línea</Link>}>
              Los modelos se agrupan en líneas (Dama, Caballero, Niños…).
            </EmptyState>
          )}
        </div>
      </section>
    </div>
  );
}
