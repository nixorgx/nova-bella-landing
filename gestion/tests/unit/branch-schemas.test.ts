import { describe, expect, it } from "vitest";
import { assignSellerSchema, branchSchema, setBranchActiveSchema } from "@/features/branches/schemas";
import { deactivationBlockers, type BranchSummary } from "@/features/branches/queries";

const branch = (patch: Partial<BranchSummary> = {}): BranchSummary => ({
  id: "b",
  name: "Central",
  city: null,
  active: true,
  units: 0,
  sellers: 0,
  openCash: false,
  ...patch,
});

describe("branch schemas", () => {
  it("trims names and turns an empty city into null", () => {
    expect(branchSchema.parse({ name: "  La Paz ", city: "  " })).toEqual({ name: "La Paz", city: null });
    expect(branchSchema.parse({ name: "Cochabamba", city: "Cochabamba" }).city).toBe("Cochabamba");
  });

  it("rejects short or oversized names", () => {
    expect(branchSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(branchSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });

  it("parses the active flag strictly and requires uuids", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(setBranchActiveSchema.parse({ branchId: id, active: "false" }).active).toBe(false);
    expect(setBranchActiveSchema.safeParse({ branchId: id, active: "maybe" }).success).toBe(false);
    expect(assignSellerSchema.safeParse({ userId: id, branchId: "no" }).success).toBe(false);
  });
});

describe("deactivationBlockers", () => {
  it("explains every reason in Spanish and is empty for an empty branch", () => {
    expect(deactivationBlockers(branch())).toEqual([]);
    const reasons = deactivationBlockers(branch({ units: 1, openCash: true, sellers: 2 }));
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain("1 par en stock");
    expect(reasons[2]).toContain("2 vendedores activos");
  });
});
