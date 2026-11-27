import { unstable_cache } from "next/cache";
import { publicQuery } from "@/lib/db";

/*
 * Everything the anonymous storefront reads comes through the public_*() database functions (role
 * app_runtime_public): they return only safe columns, never cost, users or other buyers' data.
 * Catalog data is cached for a short time (the nonce CSP forces dynamic rendering, so the data cache is what
 * keeps pages fast); admin changes expire it with updateTag("store"). Checkout always re-validates live.
 */
export const STORE_TAG = "store";
export const CATALOG_REVALIDATE_SECONDS = 30;

export interface StoreInfo {
  readonly open: boolean;
  readonly whatsapp: string | null;
  readonly bank_instructions: string | null;
  readonly policy_exchange: string | null;
  readonly policy_shipping: string | null;
  readonly has_qr: boolean;
  readonly zones: readonly { id: string; name: string; description: string | null; fee: number }[];
  readonly pickup: readonly { id: string; label: string; address: string | null; hours: string | null }[];
}

export interface CatalogModel {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly line_id: string;
  readonly line: string;
  readonly description: string | null;
  readonly price: number;
  readonly image: string | null;
  readonly image_w: number | null;
  readonly image_h: number | null;
  readonly units: number;
  readonly colors: readonly { id: string; name: string; hex: string | null; avail: boolean }[];
  readonly sizes: readonly { id: string; label: string; avail: boolean }[];
  /** "<colorId8>|<sizeId8>|<1 in stock | 0 out>" */
  readonly pairs: readonly string[];
}

export interface ProductDetail {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly line: string;
  readonly description: string | null;
  readonly price: number;
  readonly images: readonly {
    id: string;
    color_id: string | null;
    alt: string | null;
    w: number;
    h: number;
    tw: number;
    th: number;
  }[];
  readonly colors: readonly { id: string; name: string; hex: string | null }[];
  readonly sizes: readonly { id: string; label: string }[];
  readonly variants: readonly { id: string; color_id: string; size_id: string; cap: number }[];
}

export interface CartLineDetail {
  readonly variant_id: string;
  readonly slug: string;
  readonly model: string;
  readonly color: string;
  readonly color_hex: string | null;
  readonly size: string;
  readonly price: number;
  readonly cap: number;
  readonly image: string | null;
}

export interface OrderView {
  readonly code: string;
  readonly status: string;
  readonly payment_method: "qr" | "contra_entrega";
  readonly fulfillment: "delivery" | "pickup";
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly wants_invoice: boolean;
  readonly invoice_nit: string | null;
  readonly invoice_name: string | null;
  readonly zone: string | null;
  readonly address: string | null;
  readonly reference: string | null;
  readonly pickup: { label: string; address: string | null; hours: string | null } | null;
  readonly subtotal: number;
  readonly delivery_fee: number;
  readonly total: number;
  readonly notes: string | null;
  readonly payment_reference: string | null;
  readonly proof_count: number;
  readonly reject_reason: string | null;
  readonly cancel_reason: string | null;
  readonly created_at: string;
  readonly items: readonly { model: string; color: string; size: string; qty: number; unit_price: number; image: string | null }[];
  readonly events: readonly { at: string; status: string }[];
}

async function callJson<T>(sql: string, values: unknown[] = []): Promise<T> {
  const { rows } = await publicQuery<{ result: T }>(`select ${sql} as result`, values);
  return rows[0]?.result as T;
}

export const getStoreInfo = unstable_cache(
  () => callJson<StoreInfo>("public_store_info()"),
  ["store-info"],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [STORE_TAG] },
);

export const getCatalog = unstable_cache(
  async () => (await callJson<CatalogModel[] | null>("public_catalog_list()")) ?? [],
  ["store-catalog"],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [STORE_TAG] },
);

export const getProduct = unstable_cache(
  async (slug: string) => callJson<ProductDetail | null>("public_product($1)", [slug]),
  ["store-product"],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [STORE_TAG] },
);

/** Live (never cached): price and stock of the cart lines as of right now. */
export async function getCartLines(lines: readonly { variantId: string }[]): Promise<CartLineDetail[]> {
  const payload = JSON.stringify(lines.map((line) => ({ variant_id: line.variantId })));
  return (await callJson<CartLineDetail[] | null>("public_cart_lines($1::jsonb)", [payload])) ?? [];
}

export async function getOrderView(tokenHash: Buffer): Promise<OrderView | null> {
  return callJson<OrderView | null>("public_order_view($1)", [tokenHash]);
}


export { imageUrl } from "./image-url";
