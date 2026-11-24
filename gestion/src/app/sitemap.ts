import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";
import { getCatalog } from "@/features/store/public-data";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const models = await getCatalog().catch(() => []);
  return [
    { url: `${origin}/tienda`, changeFrequency: "daily", priority: 1 },
    ...models.map((model) => ({ url: `${origin}/tienda/${model.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
