-- 002: branches, users, catalog, exchange rates.
-- Money is numeric(12,2); exchange rates numeric(12,4). Never float.

create table branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  city        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index branches_name_key on branches (lower(name));

create table users (
  id             uuid primary key default gen_random_uuid(),
  username       text not null check (username ~ '^[a-z0-9._-]{3,32}$'),
  full_name      text not null check (length(btrim(full_name)) > 0),
  password_hash  text not null,
  role           text not null check (role in ('superadmin', 'seller')),
  branch_id      uuid references branches (id),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  constraint users_seller_needs_branch check (role = 'superadmin' or branch_id is not null)
);
create unique index users_username_key on users (lower(username));
create index users_branch_idx on users (branch_id);

create table product_lines (
  id      uuid primary key default gen_random_uuid(),
  name    text not null check (length(btrim(name)) > 0),
  active  boolean not null default true
);
create unique index product_lines_name_key on product_lines (lower(name));

create table models (
  id               uuid primary key default gen_random_uuid(),
  line_id          uuid not null references product_lines (id),
  name             text not null check (length(btrim(name)) > 0),
  description      text,
  base_sale_price  numeric(12,2) not null default 0 check (base_sale_price >= 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create unique index models_line_name_key on models (line_id, lower(name));

create table colors (
  id     uuid primary key default gen_random_uuid(),
  name   text not null check (length(btrim(name)) > 0),
  hex    text check (hex is null or hex ~ '^#[0-9a-fA-F]{6}$')
);
create unique index colors_name_key on colors (lower(name));

create table sizes (
  id          uuid primary key default gen_random_uuid(),
  label       text not null check (length(btrim(label)) > 0),
  sort_order  integer not null default 0
);
create unique index sizes_label_key on sizes (label);

create table variants (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid not null references models (id),
  color_id    uuid not null references colors (id),
  size_id     uuid not null references sizes (id),
  sku         text not null check (length(btrim(sku)) > 0),
  barcode     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint variants_model_color_size_key unique (model_id, color_id, size_id),
  constraint variants_sku_key unique (sku),
  constraint variants_barcode_key unique (barcode)
);
create index variants_model_idx on variants (model_id);

-- Cost-side data (readable by superadmin only; see 005_rls.sql).
create table exchange_rates (
  id             uuid primary key default gen_random_uuid(),
  rate_date      date not null,
  official_rate  numeric(12,4) not null check (official_rate > 0),
  parallel_rate  numeric(12,4) not null check (parallel_rate > 0),
  created_by     uuid references users (id),
  created_at     timestamptz not null default now()
);
create index exchange_rates_date_idx on exchange_rates (rate_date desc);

create table purchase_batches (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches (id),
  supplier    text,
  batch_date  date not null default current_date,
  rate_70     numeric(12,4) not null check (rate_70 > 0),
  rate_30     numeric(12,4) not null check (rate_30 > 0),
  split_pct   numeric(5,2) not null default 70 check (split_pct between 0 and 100),
  freight_bs  numeric(12,2) not null default 0 check (freight_bs >= 0),
  notes       text,
  created_by  uuid references users (id),
  created_at  timestamptz not null default now()
);
create index purchase_batches_branch_idx on purchase_batches (branch_id, batch_date desc);

create table purchase_items (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references purchase_batches (id),
  branch_id            uuid not null references branches (id),
  variant_id           uuid not null references variants (id),
  qty                  integer not null check (qty > 0),
  unit_cost_usd        numeric(12,2) not null check (unit_cost_usd >= 0),
  unit_cost_bs_landed  numeric(12,2) not null check (unit_cost_bs_landed >= 0),
  constraint purchase_items_batch_variant_key unique (batch_id, variant_id)
);
create index purchase_items_variant_idx on purchase_items (variant_id);

create table variant_costs (
  variant_id    uuid primary key references variants (id),
  last_cost_bs  numeric(12,2) not null check (last_cost_bs >= 0),
  avg_cost_bs   numeric(12,2) not null check (avg_cost_bs >= 0),
  updated_at    timestamptz not null default now()
);

create trigger purchase_batches_no_delete before delete on purchase_batches
  for each row execute function block_row_delete();
create trigger purchase_items_no_delete before delete on purchase_items
  for each row execute function block_row_delete();
