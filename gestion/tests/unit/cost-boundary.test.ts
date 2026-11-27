import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard for the golden rule: seller-facing code must never read or render costs.
 * Anything the seller can reach (POS, sales history, customers, cash, search, shared UI)
 * is scanned for cost tables, cost columns and cost vocabulary.
 */
const ROOT = path.resolve(__dirname, "../../src");
const SELLER_REACHABLE = [
  "features/sales",
  "features/customers",
  "features/cash",
  "features/catalog/search.ts",
  "features/catalog/variant-query.ts",
  "features/catalog/types.ts",
  "features/settings/discount.ts",
  "components/search",
  "components/scan",
  "app/api/variantes",
  "app/api/clientes",
  "app/(app)/ventas",
  "app/(app)/clientes",
];
const FORBIDDEN = /variant_costs|purchase_(batches|items)|exchange_rates|unit_cost|landed|avg_cost|last_cost|costUsd|cost_bs|features\/purchases|target_margin/i;

function files(target: string): string[] {
  const full = path.join(ROOT, target);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return [full];
  return readdirSync(full).flatMap((entry) => files(path.join(target, entry)));
}

describe("costs never reach seller-facing code", () => {
  const all = SELLER_REACHABLE.flatMap(files).filter((f) => /\.(ts|tsx|css)$/.test(f));

  it("scans a meaningful number of files", () => {
    expect(all.length).toBeGreaterThan(8);
  });

  it.each(all.map((f) => [path.relative(ROOT, f), f]))("%s has no cost vocabulary", (_name, file) => {
    const source = readFileSync(file, "utf8");
    expect(source.match(FORBIDDEN)?.[0] ?? null).toBeNull();
  });
});
