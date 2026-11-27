import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { calculateLandedCost } from "@/lib/costing";
import { systemQuery } from "../helpers/system";

interface Case {
  readonly usd: string;
  readonly r70: string;
  readonly r30: string;
  readonly split: string;
  readonly freight: string;
  readonly units: number;
}

async function sqlLanded(c: Case): Promise<string> {
  const { rows } = await systemQuery<{ v: string }>(
    "select landed_cost_bs($1::numeric, $2::numeric, $3::numeric, $4::numeric, $5::numeric, $6::integer)::text as v",
    [c.usd, c.r70, c.r30, c.split, c.freight, c.units],
  );
  return rows[0].v;
}

function tsLanded(c: Case): string {
  return calculateLandedCost({
    unitCostUsd: c.usd,
    rate70: c.r70,
    rate30: c.r30,
    splitPct: c.split,
    freightBs: c.freight,
    totalUnits: c.units,
  }).toFixed(2);
}

/** The exact (unrounded) value, to know whether a case really sits on a half-cent. */
function exact(c: Case): Decimal {
  const D = Decimal.clone({ precision: 60 });
  const share = new D(c.split).div(100);
  return new D(c.usd)
    .times(share.times(c.r70).plus(new D(1).minus(share).times(c.r30)))
    .plus(new D(c.freight).div(c.units));
}

const isHalfCent = (value: Decimal) => value.times(1000).isInteger() && value.times(1000).mod(10).eq(5);

describe("landed cost: SQL landed_cost_bs() vs costing.ts at half-cent boundaries", () => {
  const handPicked: Case[] = [
    // blended rate lands exactly on x.xx5
    { usd: "1.00", r70: "6.965", r30: "6.965", split: "70", freight: "0", units: 1 },
    { usd: "1.00", r70: "6.97", r30: "6.96", split: "50", freight: "0", units: 1 },
    { usd: "10.00", r70: "6.9650", r30: "6.9650", split: "100", freight: "0", units: 3 },
    // freight per unit contributes the half cent
    { usd: "0.00", r70: "7", r30: "9", split: "70", freight: "0.01", units: 2 },
    { usd: "0.00", r70: "7", r30: "9", split: "70", freight: "0.03", units: 2 },
    { usd: "2.00", r70: "7.00", r30: "9.00", split: "70", freight: "0.45", units: 90 },
    // classic float traps (1.005, 2.675, 1.255)
    { usd: "1.00", r70: "1.005", r30: "1.005", split: "50", freight: "0", units: 1 },
    { usd: "1.00", r70: "2.675", r30: "2.675", split: "50", freight: "0", units: 1 },
    { usd: "1.00", r70: "1.255", r30: "1.255", split: "0", freight: "0", units: 1 },
    // just below / above a half cent
    { usd: "1.00", r70: "6.9649", r30: "6.9649", split: "70", freight: "0", units: 1 },
    { usd: "1.00", r70: "6.9651", r30: "6.9651", split: "70", freight: "0", units: 1 },
  ];

  it.each(handPicked.map((c) => [JSON.stringify(c), c] as const))("%s", async (_label, c) => {
    expect(tsLanded(c)).toBe(await sqlLanded(c));
  });

  it("rounds exact half-cents half-up (away from zero) in both implementations", async () => {
    const c = { usd: "1.00", r70: "6.965", r30: "6.965", split: "70", freight: "0", units: 1 };
    expect(exact(c).toString()).toBe("6.965");
    expect(tsLanded(c)).toBe("6.97");
    expect(await sqlLanded(c)).toBe("6.97");
    const down = { ...c, r70: "6.9649", r30: "6.9649" };
    expect(tsLanded(down)).toBe("6.96");
    expect(await sqlLanded(down)).toBe("6.96");
  });

  it("agrees on a dense grid that includes many exact half-cent results", async () => {
    const usd = ["0.01", "0.10", "0.50", "1.00", "2.50", "9.99", "10.01", "33.33"];
    const rates = ["6.9600", "6.9650", "6.9700", "7.0050", "9.8750", "10.5000"];
    const splits = ["0", "33.33", "50", "70", "100"];
    const freights: Array<[string, number]> = [["0", 1], ["0.01", 2], ["37.50", 7], ["100", 3]];
    const cases: Case[] = [];
    for (const u of usd) for (const r of rates) for (const s of splits) for (const [f, n] of freights) {
      cases.push({ usd: u, r70: r, r30: rates[(rates.indexOf(r) + 2) % rates.length], split: s, freight: f, units: n });
    }
    const halfCents = cases.filter((c) => isHalfCent(exact(c)));
    expect(halfCents.length).toBeGreaterThan(30);

    const mismatches: string[] = [];
    for (const c of cases) {
      const [sql, ts] = [await sqlLanded(c), tsLanded(c)];
      if (sql !== ts) mismatches.push(`${JSON.stringify(c)} sql=${sql} ts=${ts}`);
    }
    expect(mismatches).toEqual([]);
  }, 60_000);
});
