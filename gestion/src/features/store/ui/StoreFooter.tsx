import Link from "next/link";
import { LANDING_URL } from "@/lib/landing-links";

export function StoreFooter() {
  return (
    <footer className="store-footer">
      <p>
        <strong>NovaBella</strong> · Calzado con carácter
      </p>
      <p className="store-footer__small">
        Precios en bolivianos (Bs). <a href={LANDING_URL}>Inicio</a> · <Link href="/login">Acceso del equipo</Link>
      </p>
    </footer>
  );
}
