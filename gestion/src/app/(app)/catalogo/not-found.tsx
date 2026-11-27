import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export default function CatalogNotFound() {
  return (
    <div className="page">
      <EmptyState title="No encontramos ese elemento" action={<Link className="btn" href="/catalogo">Volver al catálogo</Link>}>
        Puede que se haya eliminado o que el enlace esté incompleto.
      </EmptyState>
    </div>
  );
}
