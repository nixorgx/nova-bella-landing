import { LANDING_CATALOG_URL, LANDING_URL } from "@/lib/landing-links";
import { BrandMark } from "@/components/ui/BrandMark";
import { CartLink } from "./CartLink";

export function StoreHeader() {
  return (
    <header className="store-header">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <div className="store-header__inner">
        <a className="store-brand" href={LANDING_URL} aria-label="NovaBella, ir al inicio">
          <BrandMark className="store-brand__mark" />
          <span className="store-brand__word">
            Nova<em>Bella</em>
          </span>
        </a>
        <nav className="store-nav" aria-label="Tienda">
          <a href={LANDING_CATALOG_URL}>Catálogo</a>
          <CartLink />
        </nav>
      </div>
    </header>
  );
}
