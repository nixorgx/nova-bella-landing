import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { siteUrl } from "@/lib/env";
import { safeJsonLd } from "@/features/store/json-ld";
import { getProduct, getStoreInfo, imageUrl } from "@/features/store/public-data";
import { ProductView } from "@/features/store/ui/ProductView";
import { PurchaseInfo } from "@/features/store/ui/PurchaseInfo";

type Props = { params: Promise<{ slug: string }> };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug) || slug.length > 120) return null;
  return getProduct(slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await load(slug);
  if (!product) return { title: "Modelo no encontrado", robots: { index: false } };
  const image = product.images[0];
  const description = product.description ?? `${product.name}, calzado ${product.line} NovaBella.`;
  return {
    title: product.name,
    description,
    alternates: { canonical: `/tienda/${product.slug}` },
    openGraph: {
      type: "website",
      title: `${product.name} · NovaBella`,
      description,
      url: `/tienda/${product.slug}`,
      images: image ? [{ url: imageUrl(image.id, "full"), width: image.w, height: image.h }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, info] = await Promise.all([load(slug), getStoreInfo()]);
  if (!product) notFound();
  const origin = siteUrl();
  const pageUrl = `${origin}/tienda/${product.slug}`;
  const inStock = product.variants.some((v) => v.cap > 0);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    category: product.line,
    brand: { "@type": "Brand", name: "NovaBella" },
    image: product.images.map((i) => `${origin}${imageUrl(i.id, "full")}`),
    offers: {
      "@type": "Offer",
      url: pageUrl,
      priceCurrency: "BOB",
      price: product.price.toFixed(2),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <>
      <nav className="crumbs" aria-label="Ruta">
        <Link href="/tienda">← Catálogo</Link>
      </nav>
      <ProductView product={product} whatsapp={info.whatsapp} open={info.open} pageUrl={pageUrl} />
      <PurchaseInfo info={info} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
    </>
  );
}
