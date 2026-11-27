import { SectionNav, type SectionTab } from "@/components/ui/SectionNav";

const TABS: readonly SectionTab[] = [
  { href: "/sucursales", label: "Sucursales", exact: true },
  { href: "/sucursales/transferencias", label: "Transferencias", exact: true, also: "^/sucursales/transferencias/[0-9a-f-]{36}$" },
  { href: "/sucursales/transferencias/nueva", label: "Nueva transferencia" },
];

export default function BranchesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionNav tabs={TABS} label="Secciones de sucursales" />
      {children}
    </>
  );
}
