import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata = { title: "No encontrado" };

export default async function NotFound() {
  // Rendered per request (not prerendered) so the CSP nonce can be applied to its scripts.
  await connection();
  return (
    <main className="page">
      <EmptyState title="No encontramos esa página" action={<Link className="btn" href="/">Ir al inicio</Link>}>
        Puede que el enlace esté incompleto o que ya no exista.
      </EmptyState>
    </main>
  );
}
