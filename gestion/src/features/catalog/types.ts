import type { PoolClient } from "pg";

/** Anything with a pg-style `query` (a pooled client, or the seed's owner client). */
export type PgClient = Pick<PoolClient, "query">;

/**
 * What the variant search returns. Deliberately has NO cost fields: price and stock
 * only, so the same shape is safe for sellers (and for any future POS screen).
 */
export interface VariantHit {
  readonly variantId: string;
  readonly sku: string;
  readonly barcode: string | null;
  readonly modelId: string;
  readonly model: string;
  readonly line: string;
  readonly color: string;
  readonly colorHex: string | null;
  readonly size: string;
  readonly price: string;
  readonly stock: number;
  readonly active: boolean;
  readonly modelActive: boolean;
}

/** Domain error whose message is safe to show to the user. */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}
