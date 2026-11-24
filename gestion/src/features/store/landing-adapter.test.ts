import { describe, expect, it } from "vitest";
import { toLandingProducts, type LandingProduct } from "./landing-adapter";
import type { CatalogModel } from "./public-data";

const model: CatalogModel = {
  id: "public-id", slug: "botin-vino", name: "Botín vino", line_id: "line", line: "Botines",
  description: "Calzado de otoño", price: 479.5, image: "d2beee99-5595-42d4-8abd-849a5d12f93a",
  image_w: 400, image_h: 500, units: 2,
  colors: [{ id: "wine", name: "Vino", hex: "#661c30", avail: true }],
  sizes: [{ id: "36", label: "36", avail: false }, { id: "37", label: "37", avail: true }],
  pairs: [],
};

describe("adaptador público de la landing", () => {
  it("preserva precios exactos y disponibilidad por talla", () => {
    const [product] = toLandingProducts([model], "https://gestion.example.com");
    expect(product.price_bs).toBe(479.5);
    expect(product.category).toBe("Botines");
    expect(product.sizes).toEqual([{ label: "36", available: false }, { label: "37", available: true }]);
    expect(product.shop_url).toBe("https://gestion.example.com/tienda/botin-vino");
    expect(product.image_url).toContain("/tienda/img/");
    expect(Object.keys(product as LandingProduct)).not.toContain("cost");
  });
  it("no exporta modelos con precio inválido", () => {
    expect(toLandingProducts([{ ...model, price: 0 }], "https://gestion.example.com")).toEqual([]);
  });
  it("no inventa tallas ni fotografías", () => {
    const [product] = toLandingProducts([{ ...model, image: null, sizes: [], units: 0 }], "https://gestion.example.com");
    expect(product.sizes).toEqual([]);
    expect(product.image_url).toBeNull();
    expect(product.available).toBe(false);
  });
});
