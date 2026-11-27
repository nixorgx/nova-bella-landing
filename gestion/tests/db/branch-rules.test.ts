import { describe, expect, it } from "vitest";
import { withUser } from "@/lib/db";
import { systemQuery } from "../helpers/system";
import {
  addStock,
  closeCashSessions,
  createBranch,
  createUser,
  createVariant,
  expectPgError,
} from "../helpers/fixtures";

const setActive = (admin: Awaited<ReturnType<typeof createUser>>, id: string, active: boolean) =>
  withUser(admin, (c) => c.query("update branches set active = $2 where id = $1", [id, active]));

describe("branch deactivation guard", () => {
  it("is blocked while the branch has stock, with a message that says how many pairs", async () => {
    const admin = await createUser("superadmin", null);
    const branch = await createBranch(true, false);
    const v = await createVariant();
    await addStock(v.variantId, branch, 7);
    const error = await expectPgError(setActive(admin, branch, false), "IN005");
    expect(error.message).toContain("7 pares");
    expect(error.message).toContain("Transfiéralos");

    await addStock(v.variantId, branch, -7);
    await setActive(admin, branch, false);
    const { rows } = await systemQuery("select active from branches where id = $1", [branch]);
    expect(rows[0].active).toBe(false);
  });

  it("is blocked with an open cash session and allowed once it is closed", async () => {
    const admin = await createUser("superadmin", null);
    const branch = await createBranch(true, true);
    const error = await expectPgError(setActive(admin, branch, false), "IN005");
    expect(error.message).toContain("caja abierta");
    await closeCashSessions(branch);
    await setActive(admin, branch, false);
  });

  it("is blocked while active sellers are assigned", async () => {
    const admin = await createUser("superadmin", null);
    const branch = await createBranch(true, false);
    const seller = await createUser("seller", branch);
    await expectPgError(setActive(admin, branch, false), "IN005");
    await systemQuery("update users set active = false where id = $1", [seller.userId]);
    await setActive(admin, branch, false);
  });

  it("can be reactivated freely", async () => {
    const admin = await createUser("superadmin", null);
    const branch = await createBranch(false, false);
    await setActive(admin, branch, true);
    const { rows } = await systemQuery("select active from branches where id = $1", [branch]);
    expect(rows[0].active).toBe(true);
  });
});

describe("seller branch assignment", () => {
  it("reassigning moves the seller and invalidates the old sessions", async () => {
    const admin = await createUser("superadmin", null);
    const [a, b] = await Promise.all([createBranch(true, false), createBranch(true, false)]);
    const seller = await createUser("seller", a);
    const before = await systemQuery<{ token_version: number }>("select token_version from users where id = $1", [seller.userId]);
    await withUser(admin, (c) => c.query("update users set branch_id = $2 where id = $1 and role = 'seller'", [seller.userId, b]));
    const after = await systemQuery<{ branch_id: string; token_version: number }>("select branch_id, token_version from users where id = $1", [seller.userId]);
    expect(after.rows[0].branch_id).toBe(b);
    expect(after.rows[0].token_version).toBeGreaterThan(before.rows[0].token_version);
  });

  it("a seller can only be assigned to an active branch", async () => {
    const admin = await createUser("superadmin", null);
    const [a, inactive] = await Promise.all([createBranch(true, false), createBranch(false, false)]);
    const seller = await createUser("seller", a);
    await expectPgError(
      withUser(admin, (c) => c.query("update users set branch_id = $2 where id = $1", [seller.userId, inactive])),
      "IN005",
    );
    await expectPgError(
      withUser(admin, (c) =>
        c.query(
          "insert into users (username, full_name, password_hash, role, branch_id) values ($1, 'X Y', 'h', 'seller', $2)",
          [`nuevo${Date.now()}`, inactive],
        ),
      ),
      "IN005",
    );
  });

  it("sellers cannot edit branches or assign anyone", async () => {
    const branch = await createBranch(true, false);
    const seller = await createUser("seller", branch);
    await expectPgError(withUser(seller, (c) => c.query("update branches set name = 'Hack' where id = $1", [branch])), "42501");
    await expectPgError(withUser(seller, (c) => c.query("update users set branch_id = $1 where id = $2", [branch, seller.userId])), "42501");
    await expectPgError(withUser(seller, (c) => c.query("insert into branches (name) values ('Otra')")), "42501");
  });
});
