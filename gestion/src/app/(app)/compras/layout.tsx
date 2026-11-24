import { SectionNav, type SectionTab } from "@/components/ui/SectionNav";

const TABS: readonly SectionTab[] = [
  { href: "/compras", label: "Lotes", exact: true, also: "^/compras/[0-9a-f-]{36}$" },
  { href: "/compras/nuevo", label: "Nuevo lote" },
  { href: "/compras/tipos-de-cambio", label: "Tipos de cambio" },
  { href: "/compras/precios", label: "Precios y margen" },
];

export default function PurchasesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionNav tabs={TABS} label="Secciones de compras" />
      {children}
    </>
  );
}
