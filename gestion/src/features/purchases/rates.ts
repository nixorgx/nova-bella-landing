import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";

export interface ExchangeRate {
  readonly id: string;
  readonly rateDate: string;
  readonly officialRate: string;
  readonly parallelRate: string;
  readonly createdByName: string | null;
  readonly createdAt: string;
}

interface Row {
  id: string;
  rate_date: string;
  official_rate: string;
  parallel_rate: string;
  created_by_name: string | null;
  created_at: Date;
}

function map(row: Row): ExchangeRate {
  return {
    id: row.id,
    rateDate: row.rate_date,
    officialRate: row.official_rate,
    parallelRate: row.parallel_rate,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

/** Newest first: by rate date, then by when it was registered. */
export async function listRates(session: SessionPayload, limit = 60): Promise<ExchangeRate[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<Row>(
      `select r.id, r.rate_date, r.official_rate::text as official_rate, r.parallel_rate::text as parallel_rate,
              td.full_name as created_by_name, r.created_at
         from exchange_rates r left join team_directory() td on td.id = r.created_by
        order by r.rate_date desc, r.created_at desc limit $1`,
      [limit],
    );
    return rows.map(map);
  });
}

export async function getLatestRate(session: SessionPayload): Promise<ExchangeRate | null> {
  return (await listRates(session, 1))[0] ?? null;
}

export async function createRate(
  session: SessionPayload,
  input: { readonly rateDate: string; readonly officialRate: string; readonly parallelRate: string },
): Promise<void> {
  await withUser(session, (client) =>
    client.query(
      "insert into exchange_rates (rate_date, official_rate, parallel_rate, created_by) values ($1, $2, $3, $4)",
      [input.rateDate, input.officialRate, input.parallelRate, session.userId],
    ),
  );
}
