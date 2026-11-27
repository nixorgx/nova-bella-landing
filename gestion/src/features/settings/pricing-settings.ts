import { z } from "zod";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { dec, normalizeDecimalText } from "@/lib/money";

/** Pricing policy knobs. Superadmin only: the target margin is cost-derived information. */
export interface PricingSettings {
  readonly targetMarginPct: string;
  readonly maxDiscountPct: string | null;
}

export const DEFAULT_TARGET_MARGIN = "40";

export async function getPricingSettings(session: SessionPayload): Promise<PricingSettings> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ key: string; value: string | null }>(
      "select key, nullif(value, '') as value from app_settings where key in ('target_margin_pct', 'max_discount_pct')",
    );
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      targetMarginPct: byKey.get("target_margin_pct") ?? DEFAULT_TARGET_MARGIN,
      maxDiscountPct: byKey.get("max_discount_pct") ?? null,
    };
  });
}

const percent = (label: string, max: number, allowEmpty: boolean) =>
  z.string({ error: `Ingrese ${label}.` }).transform((value, ctx) => {
    const text = value.trim();
    if (text === "" && allowEmpty) return null;
    const normalized = normalizeDecimalText(text, 2);
    const ok = normalized !== null && dec(normalized).gte(0) && dec(normalized).lte(max);
    if (!ok) {
      ctx.addIssue({ code: "custom", message: `${label[0].toUpperCase()}${label.slice(1)} debe estar entre 0 y ${max}.` });
      return z.NEVER;
    }
    return dec(normalized).toString();
  });

export const pricingSettingsSchema = z.object({
  targetMarginPct: percent("el margen objetivo", 99.99, false).transform((value) => value ?? DEFAULT_TARGET_MARGIN),
  maxDiscountPct: percent("el descuento máximo", 100, true),
});

export async function savePricingSettings(
  session: SessionPayload,
  input: { readonly targetMarginPct: string; readonly maxDiscountPct: string | null },
): Promise<void> {
  await withUser(session, async (client) => {
    const upsert = `insert into app_settings (key, value) values ($1, $2)
                    on conflict (key) do update set value = excluded.value, updated_at = now()`;
    await client.query(upsert, ["target_margin_pct", input.targetMarginPct]);
    await client.query(upsert, ["max_discount_pct", input.maxDiscountPct]);
  });
}
