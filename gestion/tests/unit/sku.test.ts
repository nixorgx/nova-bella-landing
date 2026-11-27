import { describe, expect, it } from "vitest";
import { assignUniqueSkus, buildSkuBase, slugPart } from "@/features/catalog/sku";

describe("slugPart", () => {
  it("uppercases and strips accents", () => {
    expect(slugPart("Café")).toBe("CAFE");
    expect(slugPart("Niños")).toBe("NINOS");
  });

  it("truncates single words to the limit", () => {
    expect(slugPart("Altiplano", 6)).toBe("ALTIPL");
  });

  it("abbreviates multi-word names with three letters per word", () => {
    expect(slugPart("Azul marino", 8)).toBe("AZUMAR");
    expect(slugPart("Verde oliva", 8)).toBe("VEROLI");
  });

  it("drops punctuation and symbols", () => {
    expect(slugPart("  Rosa!! (nude) ")).toBe("ROSNUD");
    expect(slugPart("38.5")).toBe("385");
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugPart("👟 ??")).toBe("");
    expect(slugPart("")).toBe("");
  });
});

describe("buildSkuBase", () => {
  it("joins LINEA-MODELO-COLOR-TALLA", () => {
    expect(buildSkuBase({ line: "Dama", model: "Alba", color: "Negro", size: "38" })).toBe("DAM-ALBA-NEGRO-38");
  });

  it("limits each part so long names stay printable", () => {
    const sku = buildSkuBase({
      line: "Caballero",
      model: "Mocasín de cuero italiano edición limitada",
      color: "Azul marino profundo",
      size: "44",
    });
    expect(sku).toBe("CAB-MOCDECUE-AZUMAR-44");
    expect(sku.length).toBeLessThanOrEqual(32);
    expect(sku).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+){3}$/);
  });

  it("falls back to X for parts without letters or digits", () => {
    expect(buildSkuBase({ line: "Dama", model: "👟", color: "Negro", size: "38" })).toBe("DAM-X-NEGRO-38");
  });

  it("handles one-letter names", () => {
    expect(buildSkuBase({ line: "N", model: "A", color: "R", size: "S" })).toBe("N-A-R-S");
  });
});

describe("assignUniqueSkus", () => {
  it("keeps unique bases untouched", () => {
    expect(assignUniqueSkus(["A-1", "B-1"], [])).toEqual(["A-1", "B-1"]);
  });

  it("suffixes duplicates inside the same batch", () => {
    expect(assignUniqueSkus(["A-1", "A-1", "A-1"], [])).toEqual(["A-1", "A-1-2", "A-1-3"]);
  });

  it("avoids SKUs that already exist, skipping taken suffixes", () => {
    expect(assignUniqueSkus(["A-1"], ["A-1", "A-1-2"])).toEqual(["A-1-3"]);
  });

  it("compares case-insensitively", () => {
    expect(assignUniqueSkus(["A-1"], ["a-1"])).toEqual(["A-1-2"]);
  });

  it("does not mutate its inputs", () => {
    const taken = new Set(["A-1"]);
    const bases = ["A-1"];
    assignUniqueSkus(bases, taken);
    expect(bases).toEqual(["A-1"]);
    expect([...taken]).toEqual(["A-1"]);
  });
});
