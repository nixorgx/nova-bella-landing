"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/catalogo", label: "Resumen", exact: true },
  { href: "/catalogo/atributos", label: "Líneas, colores y tallas", exact: false },
  { href: "/catalogo/etiquetas", label: "Etiquetas", exact: false },
] as const;

export function CatalogSubnav() {
  const pathname = usePathname();
  return (
    <nav className="subnav" aria-label="Secciones del catálogo">
      {TABS.map((tab) => {
        const current = tab.exact
          ? pathname === tab.href || pathname.startsWith("/catalogo/modelos")
          : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} aria-current={current ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
