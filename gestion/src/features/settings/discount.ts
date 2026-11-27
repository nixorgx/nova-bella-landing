import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";

/** Highest discount (percent of list price) sellers may give. null = no limit. */
export async function getMaxDiscountPct(session: SessionPayload): Promise<string | null> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ value: string | null }>(
      "select nullif(value, '') as value from app_settings where key = 'max_discount_pct'",
    );
    return rows[0]?.value ?? null;
  });
}
