-- 014 (Demo 2): purchases/POS support.
--
--  * app_settings gains `target_margin_pct` (superadmin only: sellers must never learn it).
--    Sellers can now read ONLY `max_discount_pct` (the POS needs the floor to warn early).
--  * customers: a seller sees / edits the customers of their own branch plus the shared ones
--    (branch_id IS NULL, created by the superadmin).
--  * team_directory(): id + full name of the people that appear on the sales a caller can see
--    (a seller cannot read other `users` rows, but the sales history must show who sold).

-- ---- settings ----
alter table app_settings add constraint app_settings_target_margin_pct check (
  key <> 'target_margin_pct'
  or (case when value ~ '^[0-9]+(\.[0-9]+)?$' then value::numeric >= 0 and value::numeric < 100 else false end)
);

insert into app_settings (key, value) values ('target_margin_pct', '40')
on conflict (key) do nothing;

drop policy seller_read on app_settings;
create policy seller_read on app_settings for select to app_seller using (key = 'max_discount_pct');

-- ---- customers: branch rules ----
drop policy seller_read on customers;
drop policy seller_update on customers;
create policy seller_read on customers for select to app_seller
  using (active and (branch_id is null or branch_id = (select app_branch_id())));
create policy seller_update on customers for update to app_seller
  using (active and (branch_id is null or branch_id = (select app_branch_id())))
  with check (active and (branch_id is null or branch_id = (select app_branch_id())));

-- ---- who sold what ----
create or replace function team_directory() returns table (id uuid, full_name text)
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.full_name
    from users u
   where app_user_id() is not null
     and (
       app_role() = 'superadmin'
       or u.id = app_user_id()
       or u.branch_id = app_branch_id()
       or u.id in (select s.seller_id from sales s where s.branch_id = app_branch_id())
     )
$$;

alter function team_directory() owner to app_definer;
revoke all on function team_directory() from public;
grant execute on function team_directory() to app_seller, app_superadmin;
