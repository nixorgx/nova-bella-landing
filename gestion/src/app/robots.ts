import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: ["/tienda$", "/tienda/"], disallow: ["/tienda/pedido", "/tienda/carrito", "/tienda/qr/"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
