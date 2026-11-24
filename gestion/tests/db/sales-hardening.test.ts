import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import {
  addStock,
  closeCashSessions,
  createBranch,
  createUser,
  createVariant,
  expectPgError,
  openCashSession,
  rpcCreateSale,
  type TestVariant,
} from "../helpers/fixtures";
import { inRolledBackTx, systemQuery } from "../helpers/system";

let branch: string;
let seller: SessionPayload;
let admin: SessionPayload;
let variant: TestVariant;

beforeAll(async () => {
  branch = await createBranch();
  seller = await createUser("seller", branch);
  admin = await createUser("superadmin", null);
  variant = await createVariant("100.00");
  await addStock(variant.variantId, branch, 100);
});

const line = (price: string, qty = 1) => [{ variantId: variant.variantId, qty, finalPrice: price }];
const cash = (amount: string) => [{ method: "efectivo", amount }];

describe("create_sale input hardening", () => {
  it("rejects a final price of zero (and keeps rejecting negatives)", async () => {
    await expectPgError(
      withUser(seller, (c) => rpcCreateSale(c, { branchId: branch }, line("0.00"), cash("0.01"))),
      "IN003",
    );
    await expectPgError(
      withUser(admin, (c) => rpcCreateSale(c, { branchId: branch }, line("0"), cash("0.01"))),
      "IN003",
    );
  });

  it("rejects an empty payments list and an empty cart explicitly (IN003, not a total mismatch)", async () => {
    const error = await expectPgError(
      withUser(seller, (c) => rpcCreateSale(c, { branchId: branch }, line("10.00"), [])),
      "IN003",
    );
    expect(error.message).toMatch(/pago/i);
    await expectPgError(withUser(seller, (c) => rpcCreateSale(c, { branchId: branch }, [], cash("10.00"))), "IN003");
  });
});

describe("seller discount floor (app_settings.max_discount_pct)", () => {
  const sellerSession = () => ({ userId: seller.userId, branchId: branch, role: "seller" as const });
  const setFloor = (value: string | null) => async (client: import("pg").PoolClient) => {
    await client.query("update app_settings set value = $1 where key = 'max_discount_pct'", [value]);
  };

  it("ships with no limit by default", async () => {
    const { rows } = await systemQuery("select value from app_settings where key = 'max_discount_pct'");
    expect(rows).toEqual([{ value: null }]);
    const id = await withUser(seller, (c) => rpcCreateSale(c, { branchId: branch }, line("1.00"), cash("1.00")));
    expect(id).toBeTruthy();
  });

  it("blocks sellers below list_price * (1 - pct/100) but not at the floor", async () => {
    const run = (price: string) =>
      inRolledBackTx(sellerSession(), setFloor("20"), (c) =>
        rpcCreateSale(c, { branchId: branch }, line(price), cash(price)),
      );
    const error = await expectPgError(run("79.99"), "IN003");
    expect(error.message).toMatch(/descuento/i);
    expect(await run("80.00")).toBeTruthy();
    expect(await run("100.00")).toBeTruthy();
  });

  it("applies per line, using each variant's own list price", async () => {
    const cheap = await createVariant("10.00");
    await addStock(cheap.variantId, branch, 5);
    const sale = (second: string) =>
      inRolledBackTx(sellerSession(), setFloor("50"), (c) =>
        rpcCreateSale(
          c,
          { branchId: branch },
          [
            { variantId: variant.variantId, qty: 1, finalPrice: "50.00" },
            { variantId: cheap.variantId, qty: 1, finalPrice: second },
          ],
          cash((50 + Number(second)).toFixed(2)),
        ),
      );
    await expectPgError(sale("4.99"), "IN003");
    expect(await sale("5.00")).toBeTruthy();
  });

  it("does not limit the superadmin", async () => {
    const id = await inRolledBackTx({ userId: admin.userId, branchId: null, role: "superadmin" }, setFloor("5"), (c) =>
      rpcCreateSale(c, { branchId: branch }, line("1.00"), cash("1.00")),
    );
    expect(id).toBeTruthy();
  });

  it("only the superadmin can change the setting; sellers can read it", async () => {
    await expectPgError(
      withUser(seller, (c) => c.query("update app_settings set value = '90' where key = 'max_discount_pct'")),
      "42501",
    );
    expect((await withUser(seller, (c) => c.query("select value from app_settings"))).rows.length).toBeGreaterThan(0);
    // validated range: a percentage between 0 and 100
    await expectPgError(
      inRolledBackTx({ userId: admin.userId, branchId: null, role: "superadmin" }, async () => undefined, (c) =>
        c.query("update app_settings set value = '150' where key = 'max_discount_pct'"),
      ),
      "23514",
    );
    await expectPgError(
      inRolledBackTx({ userId: admin.userId, branchId: null, role: "superadmin" }, async () => undefined, (c) =>
        c.query("update app_settings set value = 'mucho' where key = 'max_discount_pct'"),
      ),
      "23514",
    );
  });

  it("superadmin updates through the app role (allowed) and can clear it again", async () => {
    // inside a rolled back transaction so parallel tests never see a limit
    await inRolledBackTx({ userId: admin.userId, branchId: null, role: "superadmin" }, async () => undefined, async (c) => {
      await c.query("update app_settings set value = '30' where key = 'max_discount_pct'");
      await c.query("update app_settings set value = null where key = 'max_discount_pct'");
    });
  });
});

describe("sales need an open cash session in the branch", () => {
  it("rejects a sale when the branch has no open cash session (seller and superadmin)", async () => {
    const closedBranch = await createBranch(true, false);
    const closedSeller = await createUser("seller", closedBranch);
    await addStock(variant.variantId, closedBranch, 5);
    const error = await expectPgError(
      withUser(closedSeller, (c) => rpcCreateSale(c, { branchId: closedBranch }, line("10.00"), cash("10.00"))),
      "IN005",
    );
    expect(error.message).toMatch(/caja/i);
    await expectPgError(
      withUser(admin, (c) => rpcCreateSale(c, { branchId: closedBranch }, line("10.00"), cash("10.00"))),
      "IN005",
    );
  });

  it("attaches the open session server-side, whatever the client says", async () => {
    const b = await createBranch(true, false);
    const s = await createUser("seller", b);
    await addStock(variant.variantId, b, 5);
    const sessionId = await openCashSession(b, s.userId);
    const saleId = await withUser(s, (c) => rpcCreateSale(c, { branchId: b }, line("10.00"), cash("10.00")));
    const { rows } = await systemQuery("select cash_session_id from sales where id = $1", [saleId]);
    expect(rows[0].cash_session_id).toBe(sessionId);
  });

  it("rejects a client-supplied session that is not the branch's open one", async () => {
    const other = await createBranch();
    const foreign = (await systemQuery<{ id: string }>("select id from cash_sessions where branch_id = $1", [other])).rows[0].id;
    await expectPgError(
      withUser(seller, (c) => rpcCreateSale(c, { branchId: branch, cashSessionId: foreign }, line("10.00"), cash("10.00"))),
      "IN005",
    );
  });

  it("stops selling once the session is closed and resumes with a new one", async () => {
    const b = await createBranch();
    const s = await createUser("seller", b);
    await addStock(variant.variantId, b, 5);
    const sell = () => withUser(s, (c) => rpcCreateSale(c, { branchId: b }, line("10.00"), cash("10.00")));
    await sell();
    await closeCashSessions(b);
    await expectPgError(sell(), "IN005");
    await openCashSession(b, s.userId);
    await sell();
  });
});
