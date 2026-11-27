import { describe, expect, it } from "vitest";
import { withSystem } from "../helpers/system";

async function indexNames(table: string): Promise<string[]> {
  return withSystem(async (c) => {
    const { rows } = await c.query("select indexname from pg_indexes where schemaname = 'public' and tablename = $1", [table]);
    return rows.map((r) => r.indexname);
  });
}

async function indexDef(name: string): Promise<string> {
  return withSystem(async (c) => {
    const { rows } = await c.query("select pg_get_indexdef(indexrelid) as def from pg_index where indexrelid = $1::regclass", [name]);
    return rows[0].def as string;
  });
}

describe("search and reporting indexes", () => {
  it("creates the btree indexes", async () => {
    expect(await indexNames("sales")).toEqual(
      expect.arrayContaining(["sales_cash_session_idx", "sales_seller_idx", "sales_created_idx"]),
    );
    expect(await indexNames("customers")).toContain("customers_phone_idx");
  });

  it("trigram indexes are built on the exact folded expression the search queries use", async () => {
    const folded = (col: string) => `translate(lower(COALESCE(${col}, ''::text)), 'áéíóúüñ'::text, 'aeiouun'::text)`;
    expect(await indexDef("variants_sku_trgm_idx")).toContain(`USING gin (${folded("sku")} gin_trgm_ops)`);
    expect(await indexDef("models_name_trgm_idx")).toContain(`USING gin (${folded("name")} gin_trgm_ops)`);
    expect(await indexDef("customers_name_trgm_idx")).toContain(`USING gin (${folded("name")} gin_trgm_ops)`);
  });

  it("the search code and the index share one expression (no drift)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/features/catalog/variant-query.ts", "utf8");
    expect(source).toContain("translate(lower(${expression}), '${FOLD_FROM}', '${FOLD_TO}')");
    expect(source).toContain("FOLD_FROM = \"áéíóúüñ\"");
    expect(source).toContain("FOLD_TO = \"aeiouun\"");
    expect(source).toContain("coalesce(${column}, '')");
  });
});
