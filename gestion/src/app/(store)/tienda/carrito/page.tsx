import type { Metadata } from "next";
import { getStoreInfo } from "@/features/store/public-data";
import { CartView } from "@/features/store/ui/CartView";

export const metadata: Metadata = { title: "Su carrito", robots: { index: false, follow: false } };

export default async function CartPage() {
  const info = await getStoreInfo();
  return (
    <section className="store-section" aria-labelledby="carrito-title">
      <h1 id="carrito-title">Su carrito</h1>
      <CartView open={info.open} />
    </section>
  );
}
