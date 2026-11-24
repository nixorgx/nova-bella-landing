import { describe, expect, it } from "vitest";
import { getPool, publicQuery } from "@/lib/db";
import { expectPgError } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

describe("app_runtime_public: anonymous login of the store", () => {
  it("is a plain login: no superuser, no bypassrls, no memberships, owns nothing", async () => {
    const { rows } = await systemQuery(
      "select rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin, rolinherit from pg_roles where rolname = 'app_runtime_public'",
    );
    expect(rows[0]).toMatchObject({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true });
    const member = await systemQuery("select 1 from pg_auth_members where member = 'app_runtime_public'::regrole");
    expect(member.rows).toEqual([]);
    const owned = await systemQuery("select c.relname from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'app_runtime_public'");
    expect(owned.rows).toEqual([]);
  });

  it("has no privilege at all on any table, column or sequence of the application", async () => {
    const { rows } = await systemQuery<{ rel: string }>(
      `select c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','m','S')
          and (has_table_privilege('app_runtime_public', c.oid, 'select,insert,update,delete,truncate,references,trigger')
               or (c.relkind <> 'S' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0
                     and has_column_privilege('app_runtime_public', c.oid, a.attnum, 'select,insert,update,references'))))`,
    );
    expect(rows).toEqual([]);
  });

  it("cannot even enter the private schema (pgcrypto lives there)", async () => {
    const { rows } = await systemQuery<{ ok: boolean }>("select has_schema_privilege('app_runtime_public', 'app_private', 'usage') as ok");
    expect(rows[0].ok).toBe(false);
  });

  it("is refused (42501) on every base table and on the private schema, cost tables included", async () => {
    const tables = (await systemQuery<{ relname: string }>("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")).rows.map((r) => r.relname);
    expect(tables).toEqual(expect.arrayContaining(["variant_costs", "purchase_items", "users", "web_orders", "web_order_proofs", "customers", "model_images", "app_settings"]));
    for (const table of tables) await expectPgError(publicQuery(`select * from ${table} limit 1`), "42501");
    await expectPgError(publicQuery("select * from app_private.settings"), "42501");
    await expectPgError(publicQuery("insert into web_orders (code) values ('x')"), "42501");
  });

  it("cannot execute any function except the public_* ones", async () => {
    const { rows } = await systemQuery<{ fn: string }>(
      `select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and has_function_privilege('app_runtime_public', p.oid, 'execute') and p.proname not like 'public\\_%'`,
    );
    expect(rows.map((r) => r.fn)).toEqual([]);
    for (const call of ["create_sale(null,null,'x','[]','[]',null)", "web_order_confirm(gen_random_uuid())", "web_order_cancel(gen_random_uuid(),'motivo largo')", "auth_login_lookup('x')", "revoke_user_sessions(null)"]) {
      await expectPgError(publicQuery(`select ${call}`), "42501");
    }
  });

  it("every public_* function is SECURITY DEFINER with a pinned search_path, owned by app_definer, closed to PUBLIC", async () => {
    const { rows } = await systemQuery<{ proname: string; prosecdef: boolean; owner: string; cfg: string[] | null; public_exec: boolean }>(
      `select p.proname, p.prosecdef, r.rolname as owner, p.proconfig as cfg,
              has_function_privilege('public', p.oid, 'execute') as public_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
        where n.nspname = 'public' and p.proname like 'public\\_%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect(row.owner, row.proname).toBe("app_definer");
      expect(row.public_exec, row.proname).toBe(false);
      expect((row.cfg ?? []).join(","), row.proname).toMatch(/search_path=/);
    }
  });

  it("every new table has row level security enabled", async () => {
    const { rows } = await systemQuery<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname = any($1::text[])",
      [["model_images", "store_delivery_zones", "store_pickup_points", "store_assets", "web_orders", "web_order_items", "web_order_events", "web_order_proofs"]],
    );
    expect(rows).toHaveLength(8);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("runs with short statement/lock/idle timeouts and cannot escalate", async () => {
    const client = await getPool("public").connect();
    try {
      const { rows } = await client.query("select current_setting('statement_timeout') as s, current_setting('lock_timeout') as l, current_user as u");
      expect(rows[0]).toEqual({ s: "10s", l: "4s", u: "app_runtime_public" });
      for (const target of ["postgres", "app_definer", "app_runtime_superadmin", "app_superadmin"]) {
        await client.query("begin");
        await expectPgError(client.query(`set role ${target}`), "42501");
        await client.query("rollback");
        await client.query("begin");
        await expectPgError(client.query(`set session authorization ${target}`), "42501");
        await client.query("rollback");
      }
    } finally {
      client.release();
    }
  });
});
