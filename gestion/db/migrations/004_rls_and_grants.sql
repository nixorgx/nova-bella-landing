-- 004: privileges + row level security.
-- Layered on purpose: GRANTs are the first wall, RLS the second. Cost tables are
-- NOT granted to app_seller and have no seller policy, so a seller gets a
-- permission error (and 0 rows even if a grant were added by mistake).

alter table branches          enable row level security;
alter table users             enable row level security;
alter table product_lines     enable row level security;
alter table models            enable row level security;
alter table colors            enable row level security;
alter table sizes             enable row level security;
alter table variants          enable row level security;
alter table exchange_rates    enable row level security;
alter table purchase_batches  enable row level security;
alter table purchase_items    enable row level security;
alter table variant_costs     enable row level security;
alter table stock_movements   enable row level security;
alter table stock_levels      enable row level security;
alter table customers         enable row level security;
alter table cash_sessions     enable row level security;
alter table sales             enable row level security;
alter table sale_items        enable row level security;
alter table sale_payments     enable row level security;
alter table exchanges         enable row level security;

-- ---- superadmin: full visibility, controlled writes ----
create policy superadmin_all on branches         for all to app_superadmin using (true) with check (true);
create policy superadmin_all on users            for all to app_superadmin using (true) with check (true);
create policy superadmin_all on product_lines    for all to app_superadmin using (true) with check (true);
create policy superadmin_all on models           for all to app_superadmin using (true) with check (true);
create policy superadmin_all on colors           for all to app_superadmin using (true) with check (true);
create policy superadmin_all on sizes            for all to app_superadmin using (true) with check (true);
create policy superadmin_all on variants         for all to app_superadmin using (true) with check (true);
create policy superadmin_all on exchange_rates   for all to app_superadmin using (true) with check (true);
create policy superadmin_all on purchase_batches for all to app_superadmin using (true) with check (true);
create policy superadmin_all on purchase_items   for all to app_superadmin using (true) with check (true);
create policy superadmin_all on variant_costs    for all to app_superadmin using (true) with check (true);
create policy superadmin_all on stock_movements  for all to app_superadmin using (true) with check (true);
create policy superadmin_all on stock_levels     for all to app_superadmin using (true) with check (true);
create policy superadmin_all on customers        for all to app_superadmin using (true) with check (true);
create policy superadmin_all on cash_sessions    for all to app_superadmin using (true) with check (true);
create policy superadmin_all on sales            for all to app_superadmin using (true) with check (true);
create policy superadmin_all on sale_items       for all to app_superadmin using (true) with check (true);
create policy superadmin_all on sale_payments    for all to app_superadmin using (true) with check (true);
create policy superadmin_all on exchanges        for all to app_superadmin using (true) with check (true);

-- ---- seller: catalog + own branch only; no cost tables at all ----
create policy seller_read on branches      for select to app_seller
  using (id = (select app_branch_id()));
create policy seller_read on users         for select to app_seller
  using (id = (select app_user_id()));
create policy seller_read on product_lines for select to app_seller using (active);
create policy seller_read on models        for select to app_seller using (active);
create policy seller_read on colors        for select to app_seller using (true);
create policy seller_read on sizes         for select to app_seller using (true);
create policy seller_read on variants      for select to app_seller using (active);

create policy seller_read on stock_movements for select to app_seller
  using (branch_id = (select app_branch_id()));
create policy seller_read on stock_levels    for select to app_seller
  using (branch_id = (select app_branch_id()));
create policy seller_read on sales           for select to app_seller
  using (branch_id = (select app_branch_id()));
create policy seller_read on sale_items      for select to app_seller
  using (branch_id = (select app_branch_id()));
create policy seller_read on sale_payments   for select to app_seller
  using (branch_id = (select app_branch_id()));
create policy seller_read on exchanges       for select to app_seller
  using (branch_id = (select app_branch_id()));

create policy seller_read on customers for select to app_seller using (active);
create policy seller_insert on customers for insert to app_seller
  with check (branch_id = (select app_branch_id()));
create policy seller_update on customers for update to app_seller
  using (active) with check (active);

create policy seller_read on cash_sessions for select to app_seller
  using (branch_id = (select app_branch_id()));
create policy seller_insert on cash_sessions for insert to app_seller
  with check (branch_id = (select app_branch_id()) and opened_by = (select app_user_id()));
create policy seller_update on cash_sessions for update to app_seller
  using (branch_id = (select app_branch_id()))
  with check (branch_id = (select app_branch_id()));

-- ---- privileges (nothing is granted to PUBLIC) ----
revoke all on all tables in schema public from public;

-- superadmin
grant select on all tables in schema public to app_superadmin;
revoke select on users from app_superadmin;
grant select (id, username, full_name, role, branch_id, active, created_at, last_login_at)
  on users to app_superadmin;
grant insert (username, full_name, password_hash, role, branch_id, active) on users to app_superadmin;
grant update (full_name, password_hash, branch_id, active) on users to app_superadmin;
grant insert, update on branches, product_lines, models, colors, sizes, variants,
  exchange_rates, customers, cash_sessions to app_superadmin;
-- stock/sales/purchases are written only through the SECURITY DEFINER functions.

-- seller
grant select on branches, product_lines, models, colors, sizes, variants,
  stock_movements, stock_levels, customers, cash_sessions,
  sales, sale_items, sale_payments, exchanges to app_seller;
grant select (id, username, full_name, role, branch_id, active, created_at, last_login_at)
  on users to app_seller;
grant insert (branch_id, name, phone, ci_nit, email, notes) on customers to app_seller;
grant update (name, phone, ci_nit, email, notes) on customers to app_seller;
grant insert (branch_id, opened_by, opening_amount) on cash_sessions to app_seller;
grant update (closed_at, closed_by, closing_amount) on cash_sessions to app_seller;
