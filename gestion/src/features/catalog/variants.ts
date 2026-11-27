import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { CatalogError } from "./types";

const BARCODE_CONSTRAINT = "variants_barcode_key";

/**
 * Sets or clears the barcode of one variant. A duplicate is reported with the SKU
 * that already owns the code, so the user knows exactly what to fix.
 */
export async function setVariantBarcode(
  session: SessionPayload,
  variantId: string,
  barcode: string | null,
): Promise<void> {
  try {
    const result = await withUser(session, (client) =>
      client.query("update variants set barcode = $2 where id = $1", [variantId, barcode]),
    );
    if (result.rowCount === 0) throw new CatalogError("La variante ya no existe.");
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === BARCODE_CONSTRAINT && barcode) {
      const owner = await withUser(session, (client) =>
        client.query<{ sku: string }>("select sku from variants where barcode = $1", [barcode]),
      );
      const sku = owner.rows[0]?.sku;
      throw new CatalogError(
        sku ? `Ese código de barras ya pertenece a ${sku}.` : "Ese código de barras ya está en uso.",
      );
    }
    throw error;
  }
}

export async function setVariantActive(session: SessionPayload, variantId: string, active: boolean): Promise<void> {
  await withUser(session, (client) => client.query("update variants set active = $2 where id = $1", [variantId, active]));
}
