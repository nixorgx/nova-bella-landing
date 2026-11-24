import Link from "next/link";

export function StoreFooter() {
  return (
    <footer className="store-footer">
      <p>
        <strong>NovaBella</strong> · Calzado con carácter
      </p>
      <p className="store-footer__small">
        Precios en bolivianos (Bs). <Link href="/login">Acceso del equipo</Link>
      </p>
    </footer>
  );
}
