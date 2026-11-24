import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/login.css";
import { BrandMark } from "@/components/ui/BrandMark";
import { LoginForm } from "@/features/auth/LoginForm";

export const metadata: Metadata = { title: "Ingresar" };

// Rendered per request so the CSP nonce set by the proxy can be applied to its scripts.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="login">
      <section className="login__brand" aria-label="NovaBella">
        <p className="login__eyebrow">
          <BrandMark className="login__mark" />
          Inventario · Punto de venta
        </p>
        <h1>
          Nova<em>Bella</em>
        </h1>
        <p className="login__tagline">Cada par, cada prenda y cada venta, en orden y a la mano.</p>
        <BrandMark className="login__ornament" />
      </section>
      <section className="login__panel" aria-labelledby="login-title">
        <div className="login__card">
          <div>
            <p className="eyebrow">Bienvenida</p>
            <h2 id="login-title">Ingrese a su cuenta</h2>
          </div>
          <LoginForm />
          <p className="login__store">
            <Link href="/tienda">Ir a la tienda en línea</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
