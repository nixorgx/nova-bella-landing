-- 003: append-only stock ledger, stock levels, customers, cash, sales, exchanges.

create table stock_movements (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references variants (id),
  branch_id   uuid not null references branches (id),
  qty         integer not null check (qty <> 0),
  type        text not null check (type in
              ('purchase','sale','exchange_in','exchange_out','void','adjust','transfer')),
  ref_table   text,
  ref_id      uuid,
  note        text,
  created_by  uuid references users (id),
  created_at  timestamptz not null default now()
);
create index stock_movements_variant_branch_idx on stock_movements (variant_id, branch_id);
create index stock_movements_ref_idx on stock_movements (ref_table, ref_id);
create index stock_movements_created_idx on stock_movements (branch_id, created_at desc);

-- Append-only: no UPDATE, DELETE or TRUNCATE, for anybody (owner included).
create or replace function stock_movements_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements es de solo insercion (no se puede % )', tg_op
    using errcode = 'IN004';
end
$$;

create trigger stock_movements_no_update_delete
  before update or delete on stock_movements
  for each row execute function stock_movements_immutable();
create trigger stock_movements_no_truncate
  before truncate on stock_movements
  for each statement execute function stock_movements_immutable();

-- Trigger-maintained balance. The CHECK makes negative stock impossible even
-- under concurrent writers.
create table stock_levels (
  variant_id  uuid not null references variants (id),
  branch_id   uuid not null references branches (id),
  qty         integer not null,
  updated_at  timestamptz not null default now(),
  primary key (variant_id, branch_id),
  constraint stock_levels_non_negative check (qty >= 0)
);
create index stock_levels_branch_idx on stock_levels (branch_id);

create or replace function stock_levels_apply() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- CHECK constraints run on the proposed tuple before ON CONFLICT resolution, so a
  -- negative movement must take the UPDATE path; only positive ones may upsert.
  if new.qty > 0 then
    insert into stock_levels (variant_id, branch_id, qty)
    values (new.variant_id, new.branch_id, new.qty)
    on conflict (variant_id, branch_id)
    do update set qty = stock_levels.qty + excluded.qty, updated_at = now();
  else
    update stock_levels
       set qty = qty + new.qty, updated_at = now()
     where variant_id = new.variant_id and branch_id = new.branch_id;
    if not found then
      raise exception 'Stock insuficiente para completar el movimiento' using errcode = 'IN001';
    end if;
  end if;
  return new;
exception when check_violation then
  raise exception 'Stock insuficiente para completar el movimiento' using errcode = 'IN001';
end
$$;

create trigger stock_movements_apply
  after insert on stock_movements
  for each row execute function stock_levels_apply();

create table customers (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid references branches (id),
  name        text not null check (length(btrim(name)) > 0),
  phone       text,
  ci_nit      text,
  email       text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index customers_name_idx on customers (lower(name));
create index customers_ci_nit_idx on customers (ci_nit);

create table cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches (id),
  opened_by       uuid not null references users (id),
  opened_at       timestamptz not null default now(),
  opening_amount  numeric(12,2) not null default 0 check (opening_amount >= 0),
  closed_at       timestamptz,
  closed_by       uuid references users (id),
  closing_amount  numeric(12,2) check (closing_amount is null or closing_amount >= 0)
);
create index cash_sessions_branch_idx on cash_sessions (branch_id, opened_at desc);

create table sales (
  id               uuid primary key default gen_random_uuid(),
  sale_number      bigint generated always as identity,
  branch_id        uuid not null references branches (id),
  cash_session_id  uuid references cash_sessions (id),
  customer_id      uuid references customers (id),
  seller_id        uuid not null references users (id),
  channel          text not null default 'store' check (channel in ('store', 'web')),
  doc_type         text not null check (doc_type in ('factura', 'nota_venta')),
  status           text not null default 'completed' check (status in ('completed', 'voided')),
  total            numeric(12,2) not null check (total >= 0),
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references users (id),
  void_reason      text,
  constraint sales_void_consistency check (
    (status = 'voided') = (voided_at is not null)
  )
);
create unique index sales_number_key on sales (sale_number);
create index sales_branch_created_idx on sales (branch_id, created_at desc);
create index sales_customer_idx on sales (customer_id);

create table sale_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales (id),
  branch_id    uuid not null references branches (id),
  variant_id   uuid not null references variants (id),
  qty          integer not null check (qty > 0),
  list_price   numeric(12,2) not null check (list_price >= 0),
  final_price  numeric(12,2) not null check (final_price >= 0)
);
create index sale_items_sale_idx on sale_items (sale_id);
create index sale_items_variant_idx on sale_items (variant_id);

create table sale_payments (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references sales (id),
  branch_id  uuid not null references branches (id),
  method     text not null check (method in ('efectivo', 'qr', 'transferencia', 'tarjeta')),
  amount     numeric(12,2) not null check (amount > 0)
);
create index sale_payments_sale_idx on sale_payments (sale_id);

create table exchanges (
  id                    uuid primary key default gen_random_uuid(),
  branch_id             uuid not null references branches (id),
  original_sale_id      uuid not null references sales (id),
  returned_variant_id   uuid not null references variants (id),
  new_variant_id        uuid not null references variants (id),
  qty                   integer not null default 1 check (qty > 0),
  price_diff            numeric(12,2) not null default 0,
  reason                text,
  created_by            uuid references users (id),
  created_at            timestamptz not null default now()
);
create index exchanges_sale_idx on exchanges (original_sale_id);

create trigger sales_no_delete before delete on sales
  for each row execute function block_row_delete();
create trigger sale_items_no_delete before delete on sale_items
  for each row execute function block_row_delete();
create trigger sale_payments_no_delete before delete on sale_payments
  for each row execute function block_row_delete();
create trigger exchanges_no_delete before delete on exchanges
  for each row execute function block_row_delete();
