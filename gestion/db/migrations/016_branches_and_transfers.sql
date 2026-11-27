-- 016: sucursales (Fase 7) y transferencias de stock con historial.
--
--  * stock_transfers: cabecera inmutable de cada transferencia (origen, destino, nota, quien).
--    Las lineas son los movimientos `transfer` del libro de stock con ref_id = id de la cabecera.
--  * create_stock_transfer: varias variantes en UNA transaccion (todo o nada), con las filas de
--    stock bloqueadas en orden fijo (sin deadlocks) y un solo mensaje claro si falta stock.
--  * transfer_stock (una variante) pasa a ser un envoltorio: tambien deja su cabecera.
--  * Desactivar una sucursal se bloquea en la base si tiene stock, caja abierta o vendedores
--    activos, o si es la ultima sucursal activa. Un vendedor solo puede vivir en una sucursal activa.
-- Nada de esto requiere superusuario.

-- ---- stock_transfers ----
create table stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  transfer_number  bigint generated always as identity,
  from_branch_id   uuid not null references branches (id),
  to_branch_id     uuid not null references branches (id),
  note             text check (note is null or length(note) <= 300),
  created_by       uuid references users (id),
  created_at       timestamptz not null default now(),
  constraint stock_transfers_distinct_branches check (from_branch_id <> to_branch_id)
);
create unique index stock_transfers_number_key on stock_transfers (transfer_number);
create index stock_transfers_created_idx on stock_transfers (created_at desc);
create index stock_transfers_from_idx on stock_transfers (from_branch_id);
create index stock_transfers_to_idx on stock_transfers (to_branch_id);

create or replace function stock_transfers_immutable() returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_transfers es de solo inserción (no se puede %)', tg_op using errcode = 'IN004';
end
$$;
alter function stock_transfers_immutable() owner to app_definer;
revoke all on function stock_transfers_immutable() from public;

create trigger stock_transfers_no_update_delete
  before update or delete on stock_transfers
  for each row execute function stock_transfers_immutable();
create trigger stock_transfers_no_truncate
  before truncate on stock_transfers
  for each statement execute function stock_transfers_immutable();

alter table stock_transfers enable row level security;
create policy superadmin_all on stock_transfers for all to app_superadmin using (true) with check (true);

revoke all on stock_transfers from public;
grant select on stock_transfers to app_superadmin, app_definer;
grant insert on stock_transfers to app_definer;

-- ---- create_stock_transfer ----
create or replace function create_stock_transfer(
  p_from_branch  uuid,
  p_to_branch    uuid,
  p_items        jsonb,
  p_note         text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_max_items constant integer := 200;
  c_max_qty   constant integer := 100000;
  v_id        uuid;
  v_el        jsonb;
  v_ids       uuid[] := '{}';
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_short     text;
  v_row       record;
begin
  perform assert_role(array['superadmin']);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La transferencia debe tener al menos un producto' using errcode = 'IN003';
  end if;
  if jsonb_array_length(p_items) > c_max_items then
    raise exception 'Una transferencia admite como máximo % productos', c_max_items using errcode = 'IN003';
  end if;
  if v_note is not null and length(v_note) > 300 then
    raise exception 'La nota no puede pasar de 300 caracteres' using errcode = 'IN003';
  end if;
  if p_from_branch is not distinct from p_to_branch then
    raise exception 'La sucursal de origen y destino deben ser distintas' using errcode = 'IN003';
  end if;

  -- Shape check before any cast, so a malformed payload is a clean IN003 and never a cast error.
  for v_el in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_el) <> 'object'
       or jsonb_typeof(v_el -> 'qty') <> 'number'
       or (v_el ->> 'qty') !~ '^[0-9]{1,6}$'
       or coalesce(v_el ->> 'variant_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Alguno de los productos de la transferencia no es válido' using errcode = 'IN003';
    end if;
    if (v_el ->> 'qty')::integer < 1 or (v_el ->> 'qty')::integer > c_max_qty then
      raise exception 'La cantidad de cada producto debe estar entre 1 y %', c_max_qty using errcode = 'IN003';
    end if;
    if (v_el ->> 'variant_id')::uuid = any (v_ids) then
      raise exception 'Un producto aparece repetido en la transferencia' using errcode = 'IN003';
    end if;
    v_ids := v_ids || (v_el ->> 'variant_id')::uuid;
  end loop;

  perform assert_branch_access(p_from_branch);
  perform assert_branch_access(p_to_branch);

  if exists (
    select 1 from unnest(v_ids) as u(id)
     where not exists (select 1 from variants v where v.id = u.id and v.active)
  ) then
    raise exception 'Alguno de los productos no existe o está inactivo' using errcode = 'IN005';
  end if;

  -- Lock every affected stock row in one fixed order (variant, branch): two crossing transfers
  -- (A->B and B->A) over the same variants cannot deadlock.
  perform 1 from stock_levels
   where variant_id = any (v_ids) and branch_id in (p_from_branch, p_to_branch)
   order by variant_id, branch_id
     for update;

  select string_agg(
           format('%s (disponible %s, solicitado %s)', v.sku, coalesce(sl.qty, 0), x.qty), '; '
           order by v.sku)
    into v_short
    from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer)
    join variants v on v.id = x.variant_id
    left join stock_levels sl on sl.variant_id = x.variant_id and sl.branch_id = p_from_branch
   where coalesce(sl.qty, 0) < x.qty;
  if v_short is not null then
    raise exception 'Stock insuficiente en el origen: %', v_short using errcode = 'IN001';
  end if;

  insert into stock_transfers (from_branch_id, to_branch_id, note, created_by)
  values (p_from_branch, p_to_branch, v_note, app_user_id())
  returning id into v_id;

  -- One pair of movements per product, in (variant, branch) order like the locks above.
  for v_row in
    select x.variant_id, m.branch_id, m.sign * x.qty as qty
      from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer)
     cross join (values (p_from_branch, -1), (p_to_branch, 1)) as m(branch_id, sign)
     order by x.variant_id, m.branch_id
  loop
    insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, note, created_by)
    values (v_row.variant_id, v_row.branch_id, v_row.qty, 'transfer', 'stock_transfers', v_id, v_note, app_user_id());
  end loop;

  return v_id;
end
$$;

-- transfer_stock keeps its signature and rules, and now leaves a header in the history too.
create or replace function transfer_stock(
  p_variant_id   uuid,
  p_from_branch  uuid,
  p_to_branch    uuid,
  p_qty          integer,
  p_note         text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform assert_role(array['superadmin']);
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'La cantidad debe ser mayor a cero' using errcode = 'IN003';
  end if;
  return create_stock_transfer(
    p_from_branch, p_to_branch,
    jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'qty', p_qty)),
    p_note);
end
$$;

alter function create_stock_transfer(uuid, uuid, jsonb, text) owner to app_definer;
alter function transfer_stock(uuid, uuid, uuid, integer, text) owner to app_definer;
revoke all on function create_stock_transfer(uuid, uuid, jsonb, text),
  transfer_stock(uuid, uuid, uuid, integer, text) from public;
grant execute on function create_stock_transfer(uuid, uuid, jsonb, text),
  transfer_stock(uuid, uuid, uuid, integer, text) to app_superadmin;

-- ---- branches: deactivation guard ----
create or replace function branches_guard_deactivate() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_units    bigint;
  v_sellers  integer;
begin
  if not (old.active and not new.active) then
    return new;
  end if;

  select coalesce(sum(qty), 0) into v_units from stock_levels where branch_id = old.id;
  if v_units > 0 then
    raise exception 'La sucursal "%" todavía tiene % pares en stock. Transfiéralos a otra sucursal (o ajústelos a cero) antes de desactivarla.',
      old.name, v_units using errcode = 'IN005';
  end if;
  if exists (select 1 from cash_sessions where branch_id = old.id and closed_at is null) then
    raise exception 'La sucursal "%" tiene una caja abierta. Cierre la caja antes de desactivarla.', old.name
      using errcode = 'IN005';
  end if;
  select count(*) into v_sellers from users where branch_id = old.id and active and role = 'seller';
  if v_sellers > 0 then
    raise exception 'La sucursal "%" tiene % vendedor(es) activo(s). Asígnelos a otra sucursal o desactívelos antes de desactivar la sucursal.',
      old.name, v_sellers using errcode = 'IN005';
  end if;
  if not exists (select 1 from branches where active and id <> old.id) then
    raise exception 'Debe quedar al menos una sucursal activa' using errcode = 'IN005';
  end if;
  return new;
end
$$;

alter function branches_guard_deactivate() owner to app_definer;
revoke all on function branches_guard_deactivate() from public;
create trigger branches_guard_deactivate before update of active on branches
  for each row execute function branches_guard_deactivate();

-- ---- users: a seller only lives in an ACTIVE branch ----
create or replace function users_guard_seller_branch() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'seller' and new.active
     and (tg_op = 'INSERT' or new.branch_id is distinct from old.branch_id or not old.active)
     and not exists (select 1 from branches where id = new.branch_id and active) then
    raise exception 'La sucursal del vendedor no existe o está inactiva' using errcode = 'IN005';
  end if;
  return new;
end
$$;

alter function users_guard_seller_branch() owner to app_definer;
revoke all on function users_guard_seller_branch() from public;
create trigger users_guard_seller_branch before insert or update of branch_id, active on users
  for each row execute function users_guard_seller_branch();
