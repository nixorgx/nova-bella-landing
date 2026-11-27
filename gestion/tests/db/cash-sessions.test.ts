import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { closeCashSessions, createBranch, createUser, expectPgError, openCashSession } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

let branch: string;
let seller: SessionPayload;
let colleague: SessionPayload;
let admin: SessionPayload;

beforeAll(async () => {
  branch = await createBranch(true, false);
  [seller, colleague, admin] = await Promise.all([
    createUser("seller", branch),
    createUser("seller", branch),
    createUser("superadmin", null),
  ]);
});

const close = (session: SessionPayload, id: string, closedBy: string | null = null, amount = "150.00") =>
  withUser(session, (c) =>
    c.query(
      "update cash_sessions set closed_at = now(), closed_by = $2, closing_amount = $3 where id = $1",
      [id, closedBy, amount],
    ),
  );

describe("one open cash session per branch", () => {
  it("rejects a second open session in the same branch but allows other branches", async () => {
    const b = await createBranch(true, false);
    await openCashSession(b);
    await expectPgError(openCashSession(b), "23505");
    const other = await createBranch(true, false);
    await openCashSession(other);
  });

  it("allows a new session once the previous one is closed", async () => {
    const b = await createBranch(true, false);
    await openCashSession(b);
    await closeCashSessions(b);
    await openCashSession(b);
  });

  it("applies to sellers opening through the app role too", async () => {
    const b = await createBranch(true, false);
    const s = await createUser("seller", b);
    const open = () =>
      withUser(s, (c) =>
        c.query("insert into cash_sessions (branch_id, opened_by, opening_amount) values ($1, $2, 100)", [b, s.userId]),
      );
    await open();
    await expectPgError(open(), "23505");
  });
});

describe("closing a cash session", () => {
  it("forces closed_by to the signed user and closed_at to the server clock", async () => {
    const id = await openCashSession(branch, seller.userId);
    // The seller tries to blame a colleague and back-date the closing.
    await withUser(seller, (c) =>
      c.query(
        "update cash_sessions set closed_at = '2020-01-01', closed_by = $2, closing_amount = 99 where id = $1",
        [id, colleague.userId],
      ),
    );
    const { rows } = await systemQuery("select closed_by, closing_amount, closed_at > now() - interval '1 minute' as recent from cash_sessions where id = $1", [id]);
    expect(rows[0]).toEqual({ closed_by: seller.userId, closing_amount: "99.00", recent: true });
  });

  it("requires the counted closing amount", async () => {
    const id = await openCashSession(branch, seller.userId);
    await expectPgError(
      withUser(seller, (c) => c.query("update cash_sessions set closed_at = now() where id = $1", [id])),
      "IN003",
    );
    await close(seller, id);
  });

  it("a seller cannot touch a closed session (policy: closed_at is null)", async () => {
    const id = await openCashSession(branch, seller.userId);
    await close(seller, id);
    const result = await withUser(seller, (c) =>
      c.query("update cash_sessions set closing_amount = 1 where id = $1", [id]),
    );
    expect(result.rowCount).toBe(0);
    const { rows } = await systemQuery("select closing_amount from cash_sessions where id = $1", [id]);
    expect(rows[0].closing_amount).toBe("150.00");
  });

  it("nobody (superadmin or owner) can rewrite closed_* once set", async () => {
    const id = await openCashSession(branch, seller.userId);
    await close(seller, id);
    const reopen = withUser(admin, (c) => c.query("update cash_sessions set closed_at = null where id = $1", [id]));
    await expectPgError(reopen, "IN004");
    await expectPgError(
      withUser(admin, (c) => c.query("update cash_sessions set closing_amount = 0 where id = $1", [id])),
      "IN004",
    );
    await expectPgError(
      withUser(admin, (c) => c.query("update cash_sessions set closed_by = $2 where id = $1", [id, admin.userId])),
      "IN004",
    );
    await expectPgError(systemQuery("update cash_sessions set closed_at = null where id = $1", [id]), "IN004");
  });

  it("a seller cannot close another branch's session", async () => {
    const otherBranch = await createBranch(true, false);
    const id = await openCashSession(otherBranch);
    const result = await close(seller, id);
    expect(result.rowCount).toBe(0);
  });
});
