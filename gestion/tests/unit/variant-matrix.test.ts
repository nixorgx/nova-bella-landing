import { describe, expect, it } from "vitest";
import { MAX_COMBINATIONS, planVariantMatrix } from "@/features/catalog/variant-matrix";

describe("planVariantMatrix", () => {
  it("creates every color x size pair when nothing exists", () => {
    const plan = planVariantMatrix({ colorIds: ["c1", "c2"], sizeIds: ["s1", "s2", "s3"], existing: [] });
    expect(plan.toCreate).toHaveLength(6);
    expect(plan.toSkip).toHaveLength(0);
    expect(plan.total).toBe(6);
    expect(plan.toCreate[0]).toEqual({ colorId: "c1", sizeId: "s1" });
    expect(plan.toCreate[5]).toEqual({ colorId: "c2", sizeId: "s3" });
  });

  it("skips pairs that already exist and reports them", () => {
    const plan = planVariantMatrix({
      colorIds: ["c1", "c2"],
      sizeIds: ["s1", "s2"],
      existing: [
        { colorId: "c1", sizeId: "s1" },
        { colorId: "c2", sizeId: "s2" },
        { colorId: "c9", sizeId: "s9" },
      ],
    });
    expect(plan.toCreate).toEqual([
      { colorId: "c1", sizeId: "s2" },
      { colorId: "c2", sizeId: "s1" },
    ]);
    expect(plan.toSkip).toEqual([
      { colorId: "c1", sizeId: "s1" },
      { colorId: "c2", sizeId: "s2" },
    ]);
  });

  it("ignores duplicated ids in the selection", () => {
    const plan = planVariantMatrix({ colorIds: ["c1", "c1"], sizeIds: ["s1", "s1"], existing: [] });
    expect(plan.total).toBe(1);
  });

  it("returns nothing for an empty axis", () => {
    expect(planVariantMatrix({ colorIds: [], sizeIds: ["s1"], existing: [] }).total).toBe(0);
    expect(planVariantMatrix({ colorIds: ["c1"], sizeIds: [], existing: [] }).total).toBe(0);
  });

  it("does not mutate its input", () => {
    const existing = [{ colorId: "c1", sizeId: "s1" }];
    const colorIds = ["c1"];
    planVariantMatrix({ colorIds, sizeIds: ["s1"], existing });
    expect(existing).toHaveLength(1);
    expect(colorIds).toEqual(["c1"]);
  });

  it("exposes a sane combination cap", () => {
    expect(MAX_COMBINATIONS).toBeGreaterThanOrEqual(200);
  });
});
