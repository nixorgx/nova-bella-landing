import type { Metadata } from "next";
import "@/styles/store.css";
import { siteUrl } from "@/lib/env";
import { getStoreInfo } from "@/features/store/public-data";
import { StoreFooter } from "@/features/store/ui/StoreFooter";
import { StoreHeader } from "@/features/store/ui/StoreHeader";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Tienda · NovaBella", template: "%s · NovaBella" },
  description: "Calzado NovaBella: compre en línea, pague con QR o contra entrega y reciba en casa o recoja en tienda.",
  // The rest of the app is private (noindex); the storefront is the one public surface.
  robots: { index: true, follow: true },
  openGraph: { type: "website", siteName: "NovaBella", locale: "es_BO" },
};

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const info = await getStoreInfo().catch(() => null);
  return (
    <div className="store">
      <StoreHeader />
      {info && !info.open ? (
        <p className="store-closed" role="status">
          La tienda está cerrada por ahora: puede ver el catálogo, pero los pedidos se habilitarán pronto.
        </p>
      ) : null}
      <main id="contenido" className="store-main" tabIndex={-1}>
        {children}
      </main>
      <StoreFooter />
    </div>
  );
}
