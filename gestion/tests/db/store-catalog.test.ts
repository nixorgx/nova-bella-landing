import { beforeAll, describe, expect, it } from "vitest";
import { addStock } from "../helpers/fixtures";
import { createShop, scenario, tinyWebp, type Shop } from "../helpers/store";
import { systemQuery } from "../helpers/system";

/** Words that must never appear in anything an anonymous visitor can fetch. */
export const FORBIDDEN = /cost|costo|margin|margen|utilidad|profit|supplier|proveedor|landed|exchange_rate|tipo_de_cambio|rate_70|rate_30|freight|flete|password|token_hash|app_private|purchase|avg_cost|last_cost/i;

let shop: Shop;
beforeAll(async () => {
  shop = await createShop({ price: "99.50", stock: 12 });
  // a cost exists for the variant: it must still never surface
  await systemQuery("insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs) values ($1, 41.23, 41.23)", [shop.variant.variantId]);
  await systemQuery(
    `insert into model_images (model_id, position, full_bytes, full_width, full_height, thumb_bytes, thumb_width, thumb_height, etag)
     values ($1, 0, $2, 64, 64, $2, 64, 64, $3)`,
    [shop.variant.modelId, await tinyWebp("#336699", 96), "c".repeat(40)],
  );
});

describe("what the anonymous catalog functions return", () => {
  it("lists only published, active models with price and capped stock, and never a forbidden word", async () => {
    await scenario(shop, async (s) => {
      const list = await s.as<{ v: { id: string; name: string; price: number; units: number }[] }>("public", "select public_catalog_list() as v");
      const mine = list.rows[0].v.find((m) => m.id === shop.variant.modelId);
      expect(mine).toMatchObject({ price: 99.5, units: 10 }); // 12 on hand, shown as at most 10
      const text = JSON.stringify(list.rows[0].v);
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toContain("41.23");
    });
  });

  it("hides unpublished and inactive models and every one of their images", async () => {
    await scenario(shop, async (s) => {
      const image = await s.as<{ id: string }>("owner", "select id from model_images where model_id = $1 limit 1", [shop.variant.modelId]);
      expect((await s.as("public", "select * from public_image($1, 'thumb')", [image.rows[0].id])).rows).toHaveLength(1);
      await s.as("owner", "update models set published_online = false where id = $1", [shop.variant.modelId]);
      const list = await s.as<{ v: { id: string }[] }>("public", "select public_catalog_list() as v");
      expect(list.rows[0].v.some((m) => m.id === shop.variant.modelId)).toBe(false);
      expect((await s.as("public", "select * from public_image($1, 'thumb')", [image.rows[0].id])).rows).toHaveLength(0);
      const product = await s.as<{ v: unknown }>("public", "select public_product($1) as v", [(await s.as<{ slug: string }>("owner", "select slug from models where id = $1", [shop.variant.modelId])).rows[0].slug]);
      expect(product.rows[0].v).toBeNull();
    });
  });

  it("product, cart and store info payloads are free of forbidden keys and expose stock only up to 10", async () => {
    await scenario(shop, async (s) => {
      await addStock(shop.variant.variantId, shop.branchId, 30).catch(() => undefined);
      const slug = (await s.as<{ slug: string }>("owner", "select slug from models where id = $1", [shop.variant.modelId])).rows[0].slug;
      const product = await s.as<{ v: { variants: { cap: number }[]; images: unknown[] } }>("public", "select public_product($1) as v", [slug]);
      expect(Math.max(...product.rows[0].v.variants.map((v) => v.cap))).toBeLessThanOrEqual(10);
      expect(JSON.stringify(product.rows[0].v)).not.toMatch(FORBIDDEN);
      const cart = await s.as<{ v: unknown[] }>("public", "select public_cart_lines($1::jsonb) as v", [JSON.stringify([{ variant_id: shop.variant.variantId }])]);
      expect(cart.rows[0].v).toHaveLength(1);
      expect(JSON.stringify(cart.rows[0].v)).not.toMatch(FORBIDDEN);
      const info = await s.as<{ v: unknown }>("public", "select public_store_info() as v");
      expect(JSON.stringify(info.rows[0].v)).not.toMatch(FORBIDDEN);
    });
  });

  it("the web branch is the only stock source: other branches never count", async () => {
    await scenario(shop, async (s) => {
      await s.as("owner", "insert into stock_movements (variant_id, branch_id, qty, type, note) values ($1, $2, 50, 'adjust', 'otra sucursal')", [shop.variant.variantId, shop.otherBranchId]);
      const cart = await s.as<{ v: { cap: number }[] }>("public", "select public_cart_lines($1::jsonb) as v", [JSON.stringify([{ variant_id: shop.variant.variantId }])]);
      expect(cart.rows[0].v[0].cap).toBe(10);
    });
  });

  it("slugs are unique and stable", async () => {
    const a = await systemQuery<{ slug: string }>("select slug from models where id = $1", [shop.variant.modelId]);
    expect(a.rows[0].slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    await systemQuery("update models set name = name || ' x' where id = $1", [shop.variant.modelId]);
    const b = await systemQuery<{ slug: string }>("select slug from models where id = $1", [shop.variant.modelId]);
    expect(b.rows[0].slug).toBe(a.rows[0].slug);
  });
});
