-- 009: least-privilege runtime roles, non-superuser function owner, signed request context.
--
-- Before: one owner login + `SET LOCAL ROLE`. A session could `RESET ROLE` (or
-- `SET SESSION AUTHORIZATION`) back to the owner/superuser and read anything.
-- Now the app connects with dedicated LOGIN roles that are NOT superuser, NOT owners
-- and are members of exactly one privilege role:
--
--   app_runtime_superadmin  -> app_superadmin   (pool used for superadmin sessions)
--   app_runtime_seller      -> app_seller       (pool used for seller sessions)
--   app_runtime_auth        -> nothing; only EXECUTE on the auth_* functions (010)
--
-- They are created NOLOGIN here (no secrets in migrations). `npm run db:migrate`
-- (scripts/lib/runtime-roles.ts) enables LOGIN and sets the passwords from env.
--
-- SECURITY DEFINER functions are owned by `app_definer`: NOLOGIN, not superuser.
-- It has BYPASSRLS (a non-superuser attribute) plus explicit table grants, so the
-- business functions keep working while a bug in one of them can no longer reach
-- anything the grants below do not list (no role/DDL powers, no pg_authid, ...).
-- If the hosting platform forbids BYPASSRLS, replace it with permissive
-- `to app_definer` policies; nothing else changes.
--
-- Request identity: a connection can call set_config('app.user_id', ...) with
-- anything, so identity is NOT read from plain GUCs any more. The app signs
-- "user|branch|expiry" with HMAC-SHA256 (DB_CONTEXT_SECRET) and sets the token in
-- `app.ctx`; app_user_id()/app_branch_id() verify it against a secret that only
-- app_definer can read (app_private.settings). A forged, altered, expired or
-- foreign token yields NULL, so assert_role() and every RLS policy fail closed.

create schema if not exists app_private;
create extension if not exists pgcrypto with schema app_private;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_definer') then
    create role app_definer nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_runtime_superadmin') then
    create role app_runtime_superadmin nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_runtime_seller') then
    create role app_runtime_seller nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_runtime_auth') then
    create role app_runtime_auth nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;

-- Membership without the SET option: the runtime role inherits the privileges but
-- cannot `SET ROLE` into the privilege role (or anything else).
do $$
begin
  if not exists (
    select 1 from pg_auth_members m
    where m.roleid = 'app_superadmin'::regrole and m.member = 'app_runtime_superadmin'::regrole
  ) then
    grant app_superadmin to app_runtime_superadmin with inherit true, set false;
  end if;
  if not exists (
    select 1 from pg_auth_members m
    where m.roleid = 'app_seller'::regrole and m.member = 'app_runtime_seller'::regrole
  ) then
    grant app_seller to app_runtime_seller with inherit true, set false;
  end if;
end
$$;

-- Safety nets against runaway statements (defaults for the runtime roles).
alter role app_runtime_superadmin set statement_timeout = '15s';
alter role app_runtime_superadmin set lock_timeout = '5s';
alter role app_runtime_superadmin set idle_in_transaction_session_timeout = '30s';
alter role app_runtime_seller set statement_timeout = '15s';
alter role app_runtime_seller set lock_timeout = '5s';
alter role app_runtime_seller set idle_in_transaction_session_timeout = '30s';
alter role app_runtime_auth set statement_timeout = '15s';
alter role app_runtime_auth set lock_timeout = '5s';
alter role app_runtime_auth set idle_in_transaction_session_timeout = '30s';

-- ---- private schema: only app_definer can touch it ----
revoke all on schema app_private from public;
grant usage on schema app_private to app_definer;

create table app_private.settings (
  key    text primary key,
  value  text not null
);
revoke all on app_private.settings from public;
alter table app_private.settings owner to app_definer;
grant execute on all functions in schema app_private to app_definer;

-- ---- definer privileges (explicit; nothing implicit from ownership of the tables) ----
grant usage on schema public to app_definer;
grant select on all tables in schema public to app_definer;
grant insert, update on stock_movements, stock_levels, sales, sale_items, sale_payments,
  exchanges, purchase_batches, purchase_items, variant_costs to app_definer;
grant update on cash_sessions to app_definer;
grant update (last_login_at) on users to app_definer;

-- ---- request context ----
create or replace function app_private.verified_context() returns text[]
language plpgsql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_token     text := current_setting('app.ctx', true);
  v_parts     text[];
  v_secret    text;
  v_expected  text;
  v_exp       bigint;
  v_now       bigint := extract(epoch from now())::bigint;
begin
  if v_token is null or v_token = '' then
    return null;
  end if;
  v_parts := string_to_array(v_token, '.');
  if array_length(v_parts, 1) is distinct from 4
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (v_parts[2] <> '-' and v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or v_parts[3] !~ '^[0-9]{1,12}$'
     or v_parts[4] !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select value into v_secret from app_private.settings where key = 'context_secret';
  if v_secret is null then
    return null;
  end if;

  v_expected := encode(
    app_private.hmac(v_parts[1] || '|' || v_parts[2] || '|' || v_parts[3], v_secret, 'sha256'), 'hex');
  -- Compare HMACs of both values so the comparison time does not depend on the match length.
  if app_private.hmac(v_parts[4], v_secret, 'sha256') <> app_private.hmac(v_expected, v_secret, 'sha256') then
    return null;
  end if;

  v_exp := v_parts[3]::bigint;
  if v_exp < v_now or v_exp > v_now + 300 then
    return null;
  end if;
  return array[v_parts[1], nullif(v_parts[2], '-')];
end
$$;

alter function app_private.verified_context() owner to app_definer;
revoke execute on function app_private.verified_context() from public;

create or replace function app_user_id() returns uuid
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select (app_private.verified_context())[1]::uuid
$$;

create or replace function app_branch_id() returns uuid
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select (app_private.verified_context())[2]::uuid
$$;

-- The privilege role comes from the LOGIN role of the connection (session_user is
-- not affected by SECURITY DEFINER nor by SET ROLE), never from a GUC.
create or replace function app_role() returns text
language sql stable
as $$
  select case session_user
    when 'app_runtime_superadmin' then 'superadmin'
    when 'app_runtime_seller' then 'seller'
    else null
  end
$$;

-- ---- every function is owned by the non-superuser definer and closed by default ----
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s owner to app_definer', fn.sig);
  end loop;
end
$$;

revoke execute on all functions in schema public from public;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;

grant execute on function app_role(), app_user_id(), app_branch_id()
  to app_superadmin, app_seller;
