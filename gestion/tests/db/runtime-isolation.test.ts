import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthRecord, findLoginRecord } from "@/lib/auth/auth-db";
import type { SessionPayload } from "@/lib/auth/session";
import { getPool, withUser } from "@/lib/db";
import { signContext } from "@/lib/db-context";
import { getContextSecret } from "@/lib/env";
import { addStock, createBranch, createUser, createVariant, expectPgError, rpcCreateSale } from "../helpers/fixtures";
import { systemQuery, withSystem } from "../helpers/system";

let branchA: string;
let branchB: string;
let admin: SessionPayload;
let sellerA: SessionPayload;
let sellerB: SessionPayload;
let sellerClient: PoolClient;

const secret = () => getContextSecret();

beforeAll(async () => {
  [branchA, branchB] = await Promise.all([createBranch(), createBranch()]);
  [admin, sellerA, sellerB] = await Promise.all([
    createUser("superadmin", null),
    createUser("seller", branchA),
    createUser("seller", branchB),
  ]);
  sellerClient = await getPool("seller").connect();
});

afterAll(() => sellerClient.release());

/** Runs statements on the raw seller connection in a transaction that is rolled back. */
async function raw<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await sellerClient.query("begin");
  try {
    return await fn(sellerClient);
  } finally {
    await sellerClient.query("rollback");
  }
}

describe("runtime roles are not owners or superusers", () => {
  it("have no superuser, createrole, createdb, replication or bypassrls power", async () => {
    const { rows } = await systemQuery(
      `select rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin
         from pg_roles where rolname in ('app_runtime_seller','app_runtime_superadmin','app_runtime_auth')`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true,
      });
    }
  });

  it("owns no tables and the SECURITY DEFINER owner is a non-superuser", async () => {
    const { rows: owned } = await systemQuery(
      `select c.relname from pg_class c join pg_roles r on r.oid = c.relowner
        where r.rolname like 'app_runtime_%'`,
    );
    expect(owned).toEqual([]);
    const { rows } = await systemQuery(
      "select rolsuper, rolcanlogin from pg_roles where rolname = 'app_definer'",
    );
    expect(rows).toEqual([{ rolsuper: false, rolcanlogin: false }]);
  });

  it("every SECURITY DEFINER function belongs to app_definer, never to a superuser", async () => {
    const { rows } = await systemQuery(
      `select p.oid::regprocedure::text as fn, r.rolname as owner, r.rolsuper
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
        where p.prosecdef and n.nspname in ('public', 'app_private')`,
    );
    expect(rows.length).toBeGreaterThan(8);
    expect(rows.filter((row) => row.owner !== "app_definer" || row.rolsuper)).toEqual([]);
  });

  it("run with statement/lock/idle-in-transaction timeouts", async () => {
    const { rows } = await raw((c) =>
      c.query(
        `select current_setting('statement_timeout') as statement,
                current_setting('lock_timeout') as lock,
                current_setting('idle_in_transaction_session_timeout') as idle`,
      ),
    );
    expect(rows[0]).toEqual({ statement: "15s", lock: "5s", idle: "30s" });
  });
});

describe("a seller connection cannot escape its role", () => {
  it("cannot SET SESSION AUTHORIZATION to anything else", async () => {
    for (const target of ["postgres", "app_definer", "app_runtime_superadmin"]) {
      await expectPgError(raw((c) => c.query(`set session authorization ${target}`)), "42501");
    }
  });

  it("cannot SET ROLE into the superadmin, the owner or the definer", async () => {
    for (const target of ["app_superadmin", "app_runtime_superadmin", "postgres", "app_definer"]) {
      await expectPgError(raw((c) => c.query(`set role ${target}`)), "42501");
    }
  });

  it("gains nothing from RESET ROLE", async () => {
    const identity = await raw(async (c) => {
      await c.query("reset role");
      const { rows } = await c.query("select current_user, session_user");
      return rows[0];
    });
    expect(identity).toEqual({ current_user: "app_runtime_seller", session_user: "app_runtime_seller" });
    await expectPgError(raw(async (c) => {
      await c.query("reset role");
      await c.query("select * from variant_costs");
    }), "42501");
  });

  it("cannot read cost tables, password hashes or the private schema", async () => {
    for (const table of ["variant_costs", "purchase_items", "purchase_batches", "exchange_rates", "app_private.settings"]) {
      await expectPgError(raw((c) => c.query(`select * from ${table}`)), "42501");
    }
    await expectPgError(raw((c) => c.query("select password_hash from users")), "42501");
    await expectPgError(raw((c) => c.query("select app_private.verified_context()")), "42501");
  });

  it("cannot create objects, run DDL or call the auth/cost functions", async () => {
    await expectPgError(raw((c) => c.query("create table public.pwned (x int)")), "42501");
    await expectPgError(raw((c) => c.query("create schema pwned")), "42501");
    await expectPgError(raw((c) => c.query("select * from auth_login_lookup('naty')")), "42501");
    await expectPgError(raw((c) => c.query("select revoke_user_sessions(null)")), "42501");
  });

  it("cannot alter roles or settings of other roles", async () => {
    await expectPgError(raw((c) => c.query("alter role app_runtime_superadmin password 'x'")), "42501");
    await expectPgError(raw((c) => c.query("alter role app_runtime_seller superuser")), "42501");
  });
});

describe("the request identity cannot be spoofed from SQL", () => {
  it("ignores plain app.user_id / app.branch_id settings (legacy GUCs)", async () => {
    const result = await withUser(sellerA, async (c) => {
      await c.query("select set_config('app.user_id', $1, true), set_config('app.branch_id', $2, true)", [
        sellerB.userId,
        branchB,
      ]);
      const { rows } = await c.query("select app_user_id() as uid, app_branch_id() as bid, app_role() as role");
      return rows[0];
    });
    expect(result).toEqual({ uid: sellerA.userId, bid: branchA, role: "seller" });
  });

  it("rejects a hand-made app.ctx: wrong signature, other user, expired or too far in the future", async () => {
    const forged = [
      signContext(sellerB, "not-the-real-secret-not-the-real-secret-0000"),
      signContext(sellerB, secret(), Date.now() - 3_600_000),
      signContext(sellerB, secret(), Date.now(), 3_600),
      // valid signature of sellerA with sellerB swapped in
      signContext(sellerA, secret()).replace(sellerA.userId, sellerB.userId),
      "",
      "garbage",
      `${sellerB.userId}.${branchB}.9999999999.${"0".repeat(64)}`,
    ];
    for (const token of forged) {
      const { rows } = await raw(async (c) => {
        await c.query("select set_config('app.ctx', $1, true)", [token]);
        return c.query("select app_user_id() as uid, app_branch_id() as bid");
      });
      expect(rows[0]).toEqual({ uid: null, bid: null });
    }
  });

  it("an unauthenticated context fails closed: RPCs refuse and RLS shows nothing", async () => {
    const variant = await createVariant("100.00");
    await addStock(variant.variantId, branchA, 5);
    await expectPgError(raw(async (c) => {
      await c.query("select set_config('app.ctx', 'forged', true)");
      await rpcCreateSale(c, { branchId: branchA }, [{ variantId: variant.variantId, qty: 1, finalPrice: "10.00" }], [
        { method: "efectivo", amount: "10.00" },
      ]);
    }), "IN004");
    const { rows } = await raw(async (c) => {
      await c.query("select set_config('app.ctx', 'forged', true)");
      return c.query("select 1 from stock_levels");
    });
    expect(rows).toEqual([]);
  });

  it("a seller cannot act in another branch by overriding the signed context", async () => {
    const variant = await createVariant("100.00");
    await addStock(variant.variantId, branchB, 5);
    // sellerA's valid token + a plain GUC pointing at branch B: still sellerA / branch A.
    await expectPgError(
      withUser(sellerA, async (c) => {
        await c.query("select set_config('app.branch_id', $1, true)", [branchB]);
        await rpcCreateSale(c, { branchId: branchB }, [{ variantId: variant.variantId, qty: 1, finalPrice: "10.00" }], [
          { method: "efectivo", amount: "10.00" },
        ]);
      }),
      "IN004",
    );
  });

  it("the sale is attributed to the signed user even if user_id is spoofed", async () => {
    const variant = await createVariant("100.00");
    await addStock(variant.variantId, branchA, 5);
    const saleId = await withUser(sellerA, async (c) => {
      await c.query("select set_config('app.user_id', $1, true)", [admin.userId]);
      return rpcCreateSale(c, { branchId: branchA }, [{ variantId: variant.variantId, qty: 1, finalPrice: "100.00" }], [
        { method: "efectivo", amount: "100.00" },
      ]);
    });
    const { rows } = await systemQuery("select seller_id from sales where id = $1", [saleId]);
    expect(rows[0].seller_id).toBe(sellerA.userId);
  });
});

describe("the auth role", () => {
  it("has no table privileges and can only run the auth functions", async () => {
    const client = await getPool("auth").connect();
    try {
      for (const sql of ["select * from users", "select * from branches", "select create_sale(null,null,null,null,null)"]) {
        await expectPgError(client.query(sql), "42501");
      }
      const found = await client.query("select * from auth_login_lookup('no-existe')");
      expect(found.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("does not find sellers of an inactive branch (login and session reload)", async () => {
    const branch = await createBranch();
    const seller = await createUser("seller", branch);
    const { rows } = await systemQuery<{ username: string }>("select username from users where id = $1", [seller.userId]);
    expect(await loadAuthRecord(seller.userId)).toMatchObject({ id: seller.userId, branchName: expect.any(String) });
    expect(await findLoginRecord(rows[0].username)).toMatchObject({ id: seller.userId });

    // The deactivation guard (migration 016) normally forbids this state; legacy data may still hold it,
    // so the table owner lifts the guard inside ONE transaction (DDL is transactional) to check that
    // login fails closed anyway.
    await withSystem(async (client) => {
      await client.query("alter table branches disable trigger branches_guard_deactivate");
      await client.query("update branches set active = false where id = $1", [branch]);
      await client.query("alter table branches enable trigger branches_guard_deactivate");
    });
    expect(await loadAuthRecord(seller.userId)).toBeNull();
    expect(await findLoginRecord(rows[0].username)).toBeNull();
  });

  it("does not find deactivated users and never exposes unknown ids", async () => {
    const seller = await createUser("seller", branchA, false);
    expect(await loadAuthRecord(seller.userId)).toBeNull();
    expect(await loadAuthRecord(randomUUID())).toBeNull();
  });
});

describe("token_version invalidates old sessions", () => {
  it("is bumped by password change, deactivation, branch or role change", async () => {
    const user = await createUser("seller", branchA);
    const version = async () => (await loadAuthRecord(user.userId))?.tokenVersion;
    expect(await version()).toBe(0);

    await systemQuery("update users set password_hash = 'otro-hash' where id = $1", [user.userId]);
    expect(await version()).toBe(1);
    await systemQuery("update users set branch_id = $2 where id = $1", [user.userId, branchB]);
    expect(await version()).toBe(2);
    await systemQuery("update users set full_name = 'Nuevo Nombre' where id = $1", [user.userId]);
    expect(await version()).toBe(2);
    await systemQuery("update users set active = false where id = $1", [user.userId]);
    await systemQuery("update users set active = true where id = $1", [user.userId]);
    expect(await version()).toBe(4);
  });

  it("superadmin can revoke the sessions of one user or of everybody; sellers cannot", async () => {
    const target = await createUser("seller", branchA);
    const bystander = await createUser("seller", branchA);
    await withUser(admin, (c) => c.query("select revoke_user_sessions($1)", [target.userId]));
    expect((await loadAuthRecord(target.userId))?.tokenVersion).toBe(1);
    expect((await loadAuthRecord(bystander.userId))?.tokenVersion).toBe(0);

    const { rows } = await withUser(admin, (c) => c.query("select revoke_user_sessions(null) as n"));
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
    expect((await loadAuthRecord(bystander.userId))?.tokenVersion).toBe(1);

    await expectPgError(withUser(sellerA, (c) => c.query("select revoke_user_sessions(null)")), "42501");
  });

  it("a seller cannot edit their own token_version or role directly", async () => {
    await expectPgError(withUser(sellerA, (c) => c.query("update users set token_version = 0")), "42501");
  });
});

describe("default privileges: functions are closed to PUBLIC", () => {
  it("no public function is executable by PUBLIC", async () => {
    const { rows } = await systemQuery(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app_private')
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          and (p.proacl is null
               or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))`,
    );
    expect(rows).toEqual([]);
  });

  it("functions created by later migrations are not executable by PUBLIC either", async () => {
    const acl = await withSystem(async (c) => {
      await c.query("create function public.tmp_default_privs() returns int language sql as 'select 1'");
      const { rows } = await c.query("select proacl::text as acl from pg_proc where proname = 'tmp_default_privs'");
      await c.query("drop function public.tmp_default_privs()");
      return rows[0].acl as string | null;
    });
    expect(acl).not.toBeNull();
    expect(acl).not.toMatch(/(^\{|,)=X/);
  });
});
