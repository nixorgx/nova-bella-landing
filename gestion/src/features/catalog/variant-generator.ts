import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { generateVariantsTx, type GenerateInput, type GenerateResult } from "./variant-generator-core";

export type { GenerateInput, GenerateResult } from "./variant-generator-core";

const MAX_ATTEMPTS = 3;
const SKU_CONSTRAINT = "variants_sku_key";

function isSkuConflict(error: unknown): boolean {
  const pg = error as { code?: string; constraint?: string };
  return pg.code === "23505" && pg.constraint === SKU_CONSTRAINT;
}

/** One transaction as the signed-in user; retries when another model grabbed a SKU meanwhile. */
export async function generateVariants(session: SessionPayload, input: GenerateInput): Promise<GenerateResult> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withUser(session, (client) => generateVariantsTx(client, input));
    } catch (error) {
      if (!isSkuConflict(error) || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}
