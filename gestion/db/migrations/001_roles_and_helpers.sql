-- 001: application roles, session helpers, shared trigger functions.
-- The app connects with an owner login role and, per request, runs
--   SET LOCAL ROLE app_<role>;  select set_config('app.user_id', ..., true); ...
-- so Postgres itself enforces who may read what (GRANT + RLS).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_superadmin') then
    create role app_superadmin nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_seller') then
    create role app_seller nologin;
  end if;
end
$$;

-- The login role must be a member of both roles to be able to SET ROLE to them
-- (no-op for superusers, required on hosted Postgres).
do $$
begin
  execute format('grant app_superadmin, app_seller to %I', current_user);
exception when others then
  null;
end
$$;

grant usage on schema public to app_superadmin, app_seller;

-- Session context helpers. Role is derived from the Postgres role selected with
-- SET ROLE (visible even inside SECURITY DEFINER functions through the `role` GUC).
create or replace function app_role() returns text
language sql stable
as $$
  select case current_setting('role', true)
    when 'app_superadmin' then 'superadmin'
    when 'app_seller' then 'seller'
    else null
  end
$$;

create or replace function app_user_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_branch_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('app.branch_id', true), '')::uuid
$$;

grant execute on function app_role(), app_user_id(), app_branch_id()
  to app_superadmin, app_seller;

-- Domain errors raised by the RPC functions use SQLSTATE class 'IN'.
--   IN001 insufficient stock      IN002 payments mismatch
--   IN003 validation              IN004 forbidden
--   IN005 not found / bad state

create or replace function block_row_delete() returns trigger
language plpgsql
as $$
begin
  raise exception 'Los registros de % no se pueden eliminar; use anulacion.', tg_table_name
    using errcode = 'IN004';
end
$$;
