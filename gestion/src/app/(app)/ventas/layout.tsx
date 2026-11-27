import { SectionNav, type SectionTab } from "@/components/ui/SectionNav";

const TABS: readonly SectionTab[] = [
  { href: "/ventas", label: "Punto de venta", exact: true },
  { href: "/ventas/historial", label: "Historial", also: "^/ventas/[0-9a-f-]{36}" },
  { href: "/ventas/caja", label: "Caja" },
];

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionNav tabs={TABS} label="Secciones de ventas" />
      {children}
    </>
  );
}
