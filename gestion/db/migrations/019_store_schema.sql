-- 019 (Etapa 2): tablas de la tienda online y rol de runtime publico.
--
--  * models: `published_online` (por defecto false) y `slug` estable para la URL publica.
--  * model_images: fotos optimizadas (webp, dos tamanos) guardadas en Postgres.
--  * store_delivery_zones / store_pickup_points / store_assets: configuracion editable por la superadmin.
--  * web_orders (+ items, events, proofs): pedidos de la tienda. Solo se escriben con funciones
--    SECURITY DEFINER (020/021); los logins de runtime solo tienen SELECT (superadmin: todo; vendedor: su sucursal,
--    sin comprobantes).
--  * app_runtime_public: login anonimo de minimo privilegio (NOLOGIN aqui; `db:migrate` lo activa con la
--    contrasena de DATABASE_URL_PUBLIC). No tiene acceso a NINGUNA tabla: solo EXECUTE sobre public_*().
--
-- Los pedidos web entran al sistema como `sales.channel = 'web'` al confirmarse (021).

-- ---- rol publico ----
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime_public') then
    create role app_runtime_public nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;

alter role app_runtime_public set statement_timeout = '10s';
alter role app_runtime_public set lock_timeout = '4s';
alter role app_runtime_public set idle_in_transaction_session_timeout = '15s';

-- ---- ajustes de la tienda (app_settings) ----
alter table app_settings add constraint app_settings_value_length check (value is null or length(value) <= 4000);
alter table app_settings add constraint app_settings_store_open check (
  key <> 'store_open' or value in ('true', 'false')
);
alter table app_settings add constraint app_settings_store_whatsapp check (
  key <> 'store_whatsapp' or value is null or value ~ '^[0-9]{8,15}$'
);
alter table app_settings add constraint app_settings_store_branch check (
  key <> 'store_branch_id' or value is null
  or value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

insert into app_settings (key, value) values
  ('store_open', 'false'),
  ('store_whatsapp', null),
  ('store_branch_id', null),
  ('store_bank_instructions', null),
  ('store_policy_exchange', null),
  ('store_policy_shipping', null)
on conflict (key) do nothing;

-- ---- modelos publicados ----
create or replace function store_slugify(p text) returns text
language sql immutable
as $$
  select btrim(
    regexp_replace(
      translate(lower(coalesce(p, '')), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
      '[^a-z0-9]+', '-', 'g'),
    '-')
$$;

alter table models add column published_online boolean not null default false;
alter table models add column slug text;

create or replace function models_set_slug() returns trigger
language plpgsql
as $$
declare
  v_base      text;
  v_candidate text;
  v_n         integer := 1;
begin
  if new.slug is not null then
    return new;
  end if;
  v_base := coalesce(nullif(store_slugify(new.name), ''), 'modelo');
  v_candidate := v_base;
  while exists (select 1 from models m where m.slug = v_candidate and m.id <> new.id) loop
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  end loop;
  new.slug := v_candidate;
  return new;
end
$$;

create trigger models_set_slug before insert or update on models
  for each row execute function models_set_slug();

update models set slug = null where slug is null;
alter table models alter column slug set not null;
create unique index models_slug_key on models (slug);
create index models_published_idx on models (published_online) where published_online;

-- ---- fotos ----
create table model_images (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references models (id),
  color_id      uuid references colors (id),
  position      integer not null default 0 check (position between 0 and 99),
  alt           text check (alt is null or length(alt) <= 160),
  content_type  text not null default 'image/webp' check (content_type = 'image/webp'),
  full_bytes    bytea not null check (octet_length(full_bytes) between 200 and 400000),
  full_width    integer not null check (full_width between 16 and 2000),
  full_height   integer not null check (full_height between 16 and 2000),
  thumb_bytes   bytea not null check (octet_length(thumb_bytes) between 100 and 120000),
  thumb_width   integer not null check (thumb_width between 16 and 1000),
  thumb_height  integer not null check (thumb_height between 16 and 1000),
  etag          text not null check (etag ~ '^[0-9a-f]{32,64}$'),
  created_by    uuid references users (id),
  created_at    timestamptz not null default now()
);
create index model_images_model_idx on model_images (model_id, position, created_at);

create or replace function model_images_limit() returns trigger
language plpgsql
as $$
begin
  if (select count(*) from model_images where model_id = new.model_id) >= 12 then
    raise exception 'Un modelo admite como maximo 12 fotos' using errcode = 'IN003';
  end if;
  return new;
end
$$;
create trigger model_images_limit before insert on model_images
  for each row execute function model_images_limit();

-- ---- configuracion: zonas, puntos de recojo, activos (QR de pago) ----
create table store_delivery_zones (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 80),
  description  text check (description is null or length(description) <= 200),
  fee          numeric(12,2) not null check (fee >= 0 and fee <= 9999),
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create unique index store_delivery_zones_name_key on store_delivery_zones (lower(name));

create table store_pickup_points (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches (id),
  label       text not null check (length(btrim(label)) between 1 and 80),
  address     text check (address is null or length(address) <= 200),
  hours       text check (hours is null or length(hours) <= 120),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create unique index store_pickup_points_branch_key on store_pickup_points (branch_id);

create table store_assets (
  key           text primary key check (key in ('payment_qr')),
  bytes         bytea not null check (octet_length(bytes) between 100 and 400000),
  content_type  text not null default 'image/webp' check (content_type = 'image/webp'),
  etag          text not null check (etag ~ '^[0-9a-f]{32,64}$'),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users (id)
);

-- ---- pedidos ----
create table web_orders (
  id                uuid primary key default gen_random_uuid(),
  code              text not null check (code ~ '^NB-[A-Z2-9]{6}$'),
  token_hash        bytea not null check (octet_length(token_hash) = 32),
  idempotency_key   text check (idempotency_key is null or length(idempotency_key) between 16 and 80),
  status            text not null default 'pendiente_pago' check (status in
                    ('pendiente_pago', 'pago_en_revision', 'confirmado', 'en_camino',
                     'listo_para_recoger', 'entregado', 'cancelado')),
  payment_method    text not null check (payment_method in ('qr', 'contra_entrega')),
  fulfillment       text not null check (fulfillment in ('delivery', 'pickup')),
  branch_id         uuid not null references branches (id),
  pickup_branch_id  uuid references branches (id),
  customer_name     text not null check (length(btrim(customer_name)) between 2 and 80),
  phone             text not null check (phone ~ '^[0-9]{8}$'),
  email             text check (email is null or length(email) <= 120),
  wants_invoice     boolean not null default false,
  invoice_nit       text check (invoice_nit is null or length(invoice_nit) between 3 and 20),
  invoice_name      text check (invoice_name is null or length(invoice_name) between 2 and 120),
  invoice_status    text not null default 'none' check (invoice_status in ('none', 'pending_manual', 'issued_manual')),
  delivery_zone_id  uuid references store_delivery_zones (id),
  delivery_zone     text,
  delivery_address  text check (delivery_address is null or length(delivery_address) between 5 and 200),
  delivery_reference text check (delivery_reference is null or length(delivery_reference) <= 200),
  delivery_fee      numeric(12,2) not null default 0 check (delivery_fee >= 0),
  subtotal          numeric(12,2) not null check (subtotal > 0),
  total             numeric(12,2) not null check (total > 0),
  notes             text check (notes is null or length(notes) <= 300),
  payment_reference text check (payment_reference is null or length(payment_reference) <= 60),
  proof_count       integer not null default 0 check (proof_count between 0 and 5),
  reject_reason     text check (reject_reason is null or length(reject_reason) <= 300),
  cancel_reason     text check (cancel_reason is null or length(cancel_reason) <= 300),
  sale_id           uuid references sales (id),
  customer_id       uuid references customers (id),
  collected_method  text check (collected_method is null or collected_method in ('efectivo', 'qr', 'transferencia', 'tarjeta')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  confirmed_by      uuid references users (id),
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,
  constraint web_orders_total_sum check (total = subtotal + delivery_fee),
  constraint web_orders_delivery_check check (
    (fulfillment = 'delivery') = (delivery_address is not null)
  ),
  constraint web_orders_invoice_check check (
    not wants_invoice or (invoice_nit is not null and invoice_name is not null)
  )
);
create unique index web_orders_code_key on web_orders (code);
create unique index web_orders_token_key on web_orders (token_hash);
create unique index web_orders_idem_key on web_orders (idempotency_key) where idempotency_key is not null;
create index web_orders_status_idx on web_orders (status, created_at desc);
create index web_orders_branch_idx on web_orders (branch_id, created_at desc);
create index web_orders_phone_idx on web_orders (phone, created_at desc);
create unique index web_orders_sale_key on web_orders (sale_id) where sale_id is not null;

create table web_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references web_orders (id),
  variant_id  uuid not null references variants (id),
  sku         text not null,
  model_name  text not null,
  color_name  text not null,
  size_label  text not null,
  qty         integer not null check (qty between 1 and 10),
  unit_price  numeric(12,2) not null check (unit_price > 0)
);
create index web_order_items_order_idx on web_order_items (order_id);

create table web_order_events (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references web_orders (id),
  at           timestamptz not null default now(),
  actor_id     uuid references users (id),
  actor_kind   text not null check (actor_kind in ('buyer', 'admin', 'seller', 'system')),
  from_status  text,
  to_status    text not null,
  note         text check (note is null or length(note) <= 300)
);
create index web_order_events_order_idx on web_order_events (order_id, at);

-- Comprobantes de pago: solo la superadmin los ve.
create table web_order_proofs (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references web_orders (id),
  bytes         bytea not null check (octet_length(bytes) between 100 and 600000),
  content_type  text not null default 'image/webp' check (content_type = 'image/webp'),
  etag          text not null check (etag ~ '^[0-9a-f]{32,64}$'),
  created_at    timestamptz not null default now()
);
create index web_order_proofs_order_idx on web_order_proofs (order_id, created_at);

create trigger web_orders_no_delete before delete on web_orders
  for each row execute function block_row_delete();
create trigger web_order_items_no_delete before delete on web_order_items
  for each row execute function block_row_delete();
create trigger web_order_events_no_delete before delete on web_order_events
  for each row execute function block_row_delete();
create trigger web_order_proofs_no_delete before delete on web_order_proofs
  for each row execute function block_row_delete();

-- ---- RLS ----
alter table model_images         enable row level security;
alter table store_delivery_zones enable row level security;
alter table store_pickup_points  enable row level security;
alter table store_assets         enable row level security;
alter table web_orders           enable row level security;
alter table web_order_items      enable row level security;
alter table web_order_events     enable row level security;
alter table web_order_proofs     enable row level security;

create policy superadmin_all on model_images         for all to app_superadmin using (true) with check (true);
create policy superadmin_all on store_delivery_zones for all to app_superadmin using (true) with check (true);
create policy superadmin_all on store_pickup_points  for all to app_superadmin using (true) with check (true);
create policy superadmin_all on store_assets         for all to app_superadmin using (true) with check (true);
create policy superadmin_read on web_orders          for select to app_superadmin using (true);
create policy superadmin_read on web_order_items     for select to app_superadmin using (true);
create policy superadmin_read on web_order_events    for select to app_superadmin using (true);
create policy superadmin_read on web_order_proofs    for select to app_superadmin using (true);

-- Vendedor: solo los pedidos de su sucursal (operativos); jamas comprobantes ni imagenes de configuracion.
create policy seller_read on web_orders for select to app_seller
  using (branch_id = (select app_branch_id()));
create policy seller_read on web_order_items for select to app_seller
  using (exists (select 1 from web_orders o where o.id = order_id and o.branch_id = (select app_branch_id())));
create policy seller_read on web_order_events for select to app_seller
  using (exists (select 1 from web_orders o where o.id = order_id and o.branch_id = (select app_branch_id())));

-- ---- privilegios (nada para PUBLIC ni para el rol publico) ----
revoke all on model_images, store_delivery_zones, store_pickup_points, store_assets,
  web_orders, web_order_items, web_order_events, web_order_proofs from public;

grant select, insert, update, delete on model_images to app_superadmin;
grant select, insert, update on store_delivery_zones, store_pickup_points to app_superadmin;
grant select, insert, update on store_assets to app_superadmin;
grant select on web_orders, web_order_items, web_order_events, web_order_proofs to app_superadmin;
grant select on web_orders, web_order_items, web_order_events to app_seller;

-- el definer (funciones 020/021) escribe y lee todo lo nuevo
grant select on model_images, store_delivery_zones, store_pickup_points, store_assets,
  web_order_proofs to app_definer;
grant select, insert, update on web_orders to app_definer;
grant select, insert on web_order_items, web_order_events to app_definer;
grant insert on web_order_proofs to app_definer;
grant insert, update on customers to app_definer;
