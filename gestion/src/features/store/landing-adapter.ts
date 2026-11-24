import type { CatalogModel } from "./public-data";

/** Only public fields: never expose purchase prices, identities or internal stock rows. */
export interface LandingProduct {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: string;
  readonly color: string;
  readonly price_bs: number;
  readonly description: string;
  readonly available: boolean;
  readonly sizes: readonly { label: string; available: boolean }[];
  readonly image_url: string | null;
  readonly shop_url: string;
}

export function toLandingProducts(models: readonly CatalogModel[], appOrigin: string): LandingProduct[] {
  const origin = new URL(appOrigin).origin;
  return models.filter(model => {
    const price = Number(model.price);
    return !!model.id && !!model.slug && Number.isFinite(price) && price > 0;
  }).map(model => ({
    id: String(model.id),
    slug: String(model.slug),
    name: String(model.name),
    category: String(model.line || "Calzado"),
    color: model.colors.map(item => item.name).join(", ") || "Consultar colores",
    price_bs: Number(model.price),
    description: model.description ?? "",
    available: model.units > 0,
    sizes: model.sizes.map(item => ({ label: item.label, available: item.avail })),
    image_url: model.image ? new URL(`/tienda/img/${encodeURIComponent(model.image)}?t=1`, origin).href : null,
    shop_url: new URL(`/tienda/${encodeURIComponent(model.slug)}`, origin).href,
  }));
}
