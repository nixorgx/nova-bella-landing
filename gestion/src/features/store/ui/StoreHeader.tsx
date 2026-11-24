import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";
import { CartLink } from "./CartLink";

export function StoreHeader() {
  return (
    <header className="store-header">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <div className="store-header__inner">
        <Link className="store-brand" href="/tienda" aria-label="NovaBella, ir al catálogo">
          <BrandMark className="store-brand__mark" />
          <span className="store-brand__word">
            Nova<em>Bella</em>
          </span>
        </Link>
        <nav className="store-nav" aria-label="Tienda">
          <Link href="/tienda#como-comprar">Cómo comprar</Link>
          <CartLink />
        </nav>
      </div>
    </header>
  );
}
