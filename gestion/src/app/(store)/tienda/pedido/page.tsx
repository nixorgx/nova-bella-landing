import type { Metadata } from "next";
import { getStoreInfo } from "@/features/store/public-data";
import { CheckoutForm } from "@/features/store/ui/CheckoutForm";

export const metadata: Metadata = { title: "Su pedido", robots: { index: false, follow: false } };

export default async function CheckoutPage() {
  const info = await getStoreInfo();
  return (
    <section className="store-section" aria-labelledby="pedido-title">
      <h1 id="pedido-title">Finalizar pedido</h1>
      <CheckoutForm info={info} />
    </section>
  );
}
