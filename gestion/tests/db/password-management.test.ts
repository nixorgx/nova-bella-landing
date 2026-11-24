import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { clearSharedAttempts, loadAuthRecord, reserveSharedAttempt } from "@/lib/auth/auth-db";
import { LOGIN_WINDOW_MS } from "@/lib/auth/rate-limit";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { MAX_PASSWORD_CHANGE_ATTEMPTS, passwordChangeKey } from "@/features/account/throttle";
import { createBranch, createUser, expectPgError } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

const hash = (plain: string) => bcrypt.hashSync(plain, 4);

let branchA: string;
let admin: SessionPayload;
let otherAdmin: SessionPayload;

beforeAll(async () => {
  branchA = await createBranch();
  [admin, otherAdmin] = await Promise.all([createUser("superadmin", null), createUser("superadmin", null)]);
});

/** A seller whose password is `plain`. */
async function sellerWith(plain: string): Promise<{ session: SessionPayload; hash: string }> {
  const session = await createUser("seller", branchA);
  const stored = hash(plain);
  await systemQuery("update users set password_hash = $2 where id = $1", [session.userId, stored]);
  await systemQuery("update users set token_version = 0 where id = $1", [session.userId]);
  return { session, hash: stored };
}

const row = async (id: string) =>
  (await systemQuery<{ password_hash: string; must_change_password: boolean; token_version: number; password_changed_by: string | null; password_changed_at: string | null }>(
    "select password_hash, must_change_password, token_version, password_changed_by, password_changed_at from users where id = $1",
    [id],
  )).rows[0];

describe("change_own_password", () => {
  it("replaces the caller's own hash, bumps token_version and records who and when", async () => {
    const seller = await sellerWith("clave-actual-123");
    const next = hash("clave-nueva-456");
    const { rows } = await withUser(seller.session, (c) => c.query("select change_own_password($1, $2) as v", [seller.hash, next]));
    expect(rows[0].v).toBe(1);
    const after = await row(seller.session.userId);
    expect(after.password_hash).toBe(next);
    expect(after.token_version).toBe(1);
    expect(after.must_change_password).toBe(false);
    expect(after.password_changed_by).toBe(seller.session.userId);
    expect(after.password_changed_at).not.toBeNull();
    // the old session (version 0) no longer matches what the database says
    expect((await loadAuthRecord(seller.session.userId))?.tokenVersion).toBe(1);
  });

  it("a superadmin can change their own too", async () => {
    const me = await createUser("superadmin", null);
    const old = hash("admin-actual-123");
    await systemQuery("update users set password_hash = $2 where id = $1", [me.userId, old]);
    const next = hash("admin-nueva-456");
    await withUser(me, (c) => c.query("select change_own_password($1, $2)", [old, next]));
    expect((await row(me.userId)).password_hash).toBe(next);
  });

  it("clears a pending forced change", async () => {
    const seller = await sellerWith("temporal-123456");
    await systemQuery("update users set must_change_password = true where id = $1", [seller.session.userId]);
    expect((await loadAuthRecord(seller.session.userId))?.mustChangePassword).toBe(true);
    await withUser(seller.session, (c) => c.query("select change_own_password($1, $2)", [seller.hash, hash("definitiva-123456")]));
    expect((await loadAuthRecord(seller.session.userId))?.mustChangePassword).toBe(false);
  });

  it("writes nothing when the stored hash is not the one that was verified (stale form, concurrent reset)", async () => {
    const seller = await sellerWith("clave-actual-123");
    await expectPgError(
      withUser(seller.session, (c) => c.query("select change_own_password($1, $2)", [hash("otra-clave-que-no-es"), hash("clave-nueva-456")])),
      "IN005",
    );
    expect((await row(seller.session.userId)).password_hash).toBe(seller.hash);
    expect((await row(seller.session.userId)).token_version).toBe(0);
  });

  it("only ever touches the caller's own row, never somebody else's (identity comes from the signed context)", async () => {
    const mine = await sellerWith("clave-mia-123456");
    const theirs = await sellerWith("clave-ajena-123456");
    // even holding the other user's current hash, the write cannot reach their row
    await expectPgError(
      withUser(mine.session, (c) => c.query("select change_own_password($1, $2)", [theirs.hash, hash("clave-robada-123456")])),
      "IN005",
    );
    expect((await row(theirs.session.userId)).password_hash).toBe(theirs.hash);
    expect((await row(mine.session.userId)).password_hash).toBe(mine.hash);
  });

  it("rejects anything that is not a bcrypt hash", async () => {
    const seller = await sellerWith("clave-actual-123");
    for (const bad of ["plain-text-password", "", "$2b$04$short"]) {
      await expectPgError(withUser(seller.session, (c) => c.query("select change_own_password($1, $2)", [seller.hash, bad])), "IN003");
    }
    expect((await row(seller.session.userId)).password_hash).toBe(seller.hash);
  });

  it("an inactive account cannot change anything", async () => {
    const seller = await sellerWith("clave-actual-123");
    await systemQuery("update users set active = false where id = $1", [seller.session.userId]);
    await expectPgError(withUser(seller.session, (c) => c.query("select change_own_password($1, $2)", [seller.hash, hash("clave-nueva-456")])), "IN005");
  });
});

describe("admin_reset_password", () => {
  it("sets a new hash for a seller, forces the change, kills their sessions and records the actor", async () => {
    const seller = await sellerWith("clave-actual-123");
    const temp = hash("Temporal-Frase-47");
    const { rows } = await withUser(admin, (c) => c.query("select admin_reset_password($1, $2, true) as v", [seller.session.userId, temp]));
    expect(rows[0].v).toBe(1);
    const after = await row(seller.session.userId);
    expect(after.password_hash).toBe(temp);
    expect(after.must_change_password).toBe(true);
    expect(after.token_version).toBe(1);
    expect(after.password_changed_by).toBe(admin.userId);
    expect((await loadAuthRecord(seller.session.userId))?.mustChangePassword).toBe(true);
  });

  it("can reset another superadmin and can skip the forced change", async () => {
    const temp = hash("Temporal-Frase-48");
    await withUser(admin, (c) => c.query("select admin_reset_password($1, $2, false)", [otherAdmin.userId, temp]));
    const after = await row(otherAdmin.userId);
    expect(after.password_hash).toBe(temp);
    expect(after.must_change_password).toBe(false);
  });

  it("refuses to reset oneself (that goes through the current-password check) or an unknown user, or a non-hash", async () => {
    const temp = hash("Temporal-Frase-49");
    await expectPgError(withUser(admin, (c) => c.query("select admin_reset_password($1, $2, true)", [admin.userId, temp])), "IN004");
    await expectPgError(withUser(admin, (c) => c.query("select admin_reset_password($1, $2, true)", ["11111111-1111-4111-8111-111111111111", temp])), "IN005");
    const seller = await sellerWith("clave-actual-123");
    await expectPgError(withUser(admin, (c) => c.query("select admin_reset_password($1, $2, true)", [seller.session.userId, "plain"])), "IN003");
  });

  it("a seller cannot reset anybody (not even themselves) and cannot call it at all", async () => {
    const victim = await sellerWith("clave-victima-123");
    const attacker = await sellerWith("clave-atacante-123");
    await expectPgError(withUser(attacker.session, (c) => c.query("select admin_reset_password($1, $2, false)", [victim.session.userId, hash("clave-robada-123456")])), "42501");
    await expectPgError(withUser(attacker.session, (c) => c.query("select admin_reset_password($1, $2, false)", [attacker.session.userId, hash("clave-robada-123456")])), "42501");
    expect((await row(victim.session.userId)).password_hash).toBe(victim.hash);
  });
});

describe("the runtime roles gained no write access to users", () => {
  it("neither seller nor superadmin can update password, flag or version directly, and a seller cannot even read them", async () => {
    const seller = await sellerWith("clave-actual-123");
    for (const sql of [
      "update users set password_hash = 'x'",
      "update users set must_change_password = true",
      "update users set password_changed_by = null",
      "update users set token_version = 99",
    ]) {
      await expectPgError(withUser(seller.session, (c) => c.query(sql)), "42501");
      await expectPgError(withUser(admin, (c) => c.query(sql)), "42501");
    }
    await expectPgError(withUser(seller.session, (c) => c.query("select must_change_password from users")), "42501");
    await expectPgError(withUser(seller.session, (c) => c.query("select password_hash from users")), "42501");
    await expectPgError(withUser(admin, (c) => c.query("select password_hash from users")), "42501");
  });

  it("the superadmin can read who/when and the flag (for the Usuarios screen), nothing secret", async () => {
    const { rows } = await withUser(admin, (c) => c.query("select must_change_password, password_changed_at, password_changed_by from users limit 1"));
    expect(rows).toHaveLength(1);
  });

  it("both functions are SECURITY DEFINER, owned by app_definer, with a fixed search_path and closed to PUBLIC", async () => {
    const { rows } = await systemQuery<{ proname: string; owner: string; secdef: boolean; config: string[] | null; public_exec: boolean }>(
      `select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef as secdef, p.proconfig as config,
              coalesce(exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0), p.proacl is null) as public_exec
         from pg_proc p where p.proname in ('change_own_password', 'admin_reset_password')`,
    );
    expect(rows).toHaveLength(2);
    for (const fn of rows) {
      expect(fn.owner).toBe("app_definer");
      expect(fn.secdef).toBe(true);
      expect(fn.config?.some((entry) => entry.startsWith("search_path="))).toBe(true);
      expect(fn.public_exec).toBe(false);
    }
  });
});

describe("password change attempts use the shared database throttle", () => {
  it("allows five wrong current passwords per window, then blocks, and a success clears the counter", async () => {
    const key = passwordChangeKey(`test-${Math.random()}`);
    const answers = [];
    for (let i = 0; i < MAX_PASSWORD_CHANGE_ATTEMPTS + 2; i += 1) answers.push((await reserveSharedAttempt(key, MAX_PASSWORD_CHANGE_ATTEMPTS, LOGIN_WINDOW_MS)).allowed);
    expect(answers.filter(Boolean)).toHaveLength(MAX_PASSWORD_CHANGE_ATTEMPTS);
    await clearSharedAttempts(key);
    expect((await reserveSharedAttempt(key, MAX_PASSWORD_CHANGE_ATTEMPTS, LOGIN_WINDOW_MS)).allowed).toBe(true);
  });
});
