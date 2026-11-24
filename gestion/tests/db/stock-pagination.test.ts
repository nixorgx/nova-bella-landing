import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/lib/auth/guards";
import { listStock } from "@/features/stock/queries";
import { addStock, createBranch, createUser, createVariant } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

let branch: string;
let seller: AuthUser;
let admin: AuthUser;

async function authUser(role: "seller" | "superadmin", branchId: string | null): Promise<AuthUser> {
  const session = await createUser(role, branchId);
  return { id: session.userId, username: "t", fullName: "T", role, branchId, branchName: null, mustChangePassword: false };
}

beforeAll(async () => {
  branch = await createBranch();
  seller = await authUser("seller", branch);
  admin = await authUser("superadmin", null);
  for (let i = 0; i < 23; i++) {
    const v = await createVariant();
    await addStock(v.variantId, branch, i + 1);
  }
  // another branch must never leak into the seller's pages
  const other = await createBranch();
  const foreign = await createVariant();
  await addStock(foreign.variantId, other, 5);
});

describe("listStock pagination", () => {
  it("returns the total and only the requested page (no silent truncation)", async () => {
    const first = await listStock(seller, { page: 1, pageSize: 10 });
    expect(first).toMatchObject({ total: 23, page: 1, pageSize: 10, pageCount: 3, from: 1, to: 10 });
    expect(first.rows).toHaveLength(10);

    const last = await listStock(seller, { page: 3, pageSize: 10 });
    expect(last).toMatchObject({ page: 3, from: 21, to: 23 });
    expect(last.rows).toHaveLength(3);
  });

  it("pages never overlap and together cover every row exactly once", async () => {
    const skus = new Set<string>();
    for (const page of [1, 2, 3]) {
      for (const row of (await listStock(seller, { page, pageSize: 10 })).rows) {
        expect(skus.has(row.sku)).toBe(false);
        skus.add(row.sku);
      }
    }
    expect(skus.size).toBe(23);
  });

  it("clamps a page past the end to the last page", async () => {
    const result = await listStock(seller, { page: 99, pageSize: 10 });
    expect(result.page).toBe(3);
    expect(result.rows).toHaveLength(3);
  });

  it("pages over every branch for the superadmin and reports the real total", async () => {
    const count = async () =>
      (await systemQuery<{ n: number }>("select count(distinct variant_id)::int as n from stock_levels")).rows[0].n;
    // Other test files add stock concurrently, so the total can only be bracketed.
    const before = await count();
    const everything = await listStock(admin, { page: 1, pageSize: 200 });
    const after = await count();
    expect(everything.total).toBeGreaterThanOrEqual(before);
    expect(everything.total).toBeLessThanOrEqual(after);
    expect(everything.rows.length).toBeLessThanOrEqual(200);
  });
});
