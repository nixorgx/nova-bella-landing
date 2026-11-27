"use client";

import { useRouter } from "next/navigation";
import { VariantSearch } from "@/components/search/VariantSearch";
import type { VariantHit } from "../types";

/** Search / scan box that jumps straight to the model page of the chosen variant. */
export function CatalogLookup() {
  const router = useRouter();
  return (
    <VariantSearch
      scanner
      includeInactive
      label="Buscar o escanear una variante"
      onSelect={(hit: VariantHit) => router.push(`/catalogo/modelos/${hit.modelId}?v=${hit.variantId}`)}
    />
  );
}
