-- 011: cash sessions get real rules, plus a tiny settings table.
--
--  * one OPEN cash session per branch (partial unique index);
--  * a seller may only change a session while it is open;
--  * once closed, a session is frozen (closed_* can never be rewritten, by anybody);
--  * closing stamps closed_by = the signed user and closed_at = the server clock.

create unique index cash_sessions_one_open_per_branch
  on cash_sessions (branch_id) where closed_at is null;

drop policy seller_update on cash_sessions;
create policy seller_update on cash_sessions for update to app_seller
  using (branch_id = (select app_branch_id()) and closed_at is null)
  with check (branch_id = (select app_branch_id()));

create or replace function cash_sessions_guard() returns trigger
language plpgsql
as $$
begin
  if old.closed_at is not null then
    if new is distinct from old then
      raise exception 'Una caja cerrada no se puede modificar' using errcode = 'IN004';
    end if;
    return new;
  end if;

  if (new.branch_id, new.opened_by, new.opened_at)
     is distinct from (old.branch_id, old.opened_by, old.opened_at) then
    raise exception 'La sucursal y la apertura de una caja no se pueden modificar' using errcode = 'IN004';
  end if;

  if new.closed_at is not null then
    if new.closing_amount is null then
      raise exception 'Ingrese el monto contado al cerrar la caja' using errcode = 'IN003';
    end if;
    new.closed_at := now();
    new.closed_by := coalesce(app_user_id(), new.closed_by);
  elsif new.closed_by is not null then
    raise exception 'closed_by solo puede definirse al cerrar la caja' using errcode = 'IN003';
  end if;
  return new;
end
$$;

alter function cash_sessions_guard() owner to app_definer;
revoke all on function cash_sessions_guard() from public;

create trigger cash_sessions_guard before update on cash_sessions
  for each row execute function cash_sessions_guard();

-- ---- app_settings: key/value knobs editable only by the superadmin ----
create table app_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value       text,
  updated_at  timestamptz not null default now(),
  -- max_discount_pct: NULL = no limit, otherwise a percentage between 0 and 100.
  constraint app_settings_max_discount_pct check (
    key <> 'max_discount_pct' or value is null
    or (case when value ~ '^[0-9]+(\.[0-9]+)?$' then value::numeric <= 100 else false end)
  )
);

insert into app_settings (key, value) values ('max_discount_pct', null);

alter table app_settings enable row level security;
create policy superadmin_all on app_settings for all to app_superadmin using (true) with check (true);
create policy seller_read on app_settings for select to app_seller using (true);

revoke all on app_settings from public;
grant select on app_settings to app_superadmin, app_seller, app_definer;
grant insert, update on app_settings to app_superadmin;
