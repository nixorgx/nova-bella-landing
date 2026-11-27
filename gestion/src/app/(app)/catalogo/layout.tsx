import { CatalogSubnav } from "@/features/catalog/ui/CatalogSubnav";

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CatalogSubnav />
      {children}
    </>
  );
}
