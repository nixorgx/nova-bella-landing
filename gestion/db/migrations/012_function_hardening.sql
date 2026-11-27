-- 012: hardened RPCs (CREATE OR REPLACE keeps owner and grants).
--
--  create_sale            : price > 0, at least one item AND one payment, seller discount
--                           floor, and the sale is attached to the branch's OPEN cash
--                           session server-side (required for superadmin too: a register
--                           must be open to sell; relax here if that ever changes).
--  create_exchange        : only the superadmin may override the price difference, and
--                           only within bounds; otherwise it is computed from the prices.
--  create_purchase_batch  : variant_costs row is locked (or created) BEFORE on-hand stock
--                           is read, so concurrent purchases cannot corrupt the average
--                           nor hit a unique violation on the first purchase.
--  transfer_stock         : stock rows are locked in branch_id order (no deadlocks).

create or replace function create_sale(
  p_branch_id        uuid,
  p_customer_id      uuid,
  p_doc_type         text,
  p_items            jsonb,   -- [{variant_id, qty, final_price}]
  p_payments         jsonb,   -- [{method, amount}]
  p_cash_session_id  uuid default null  -- optional: must equal the branch's open session
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale_id    uuid;
  v_total      numeric(12,2);
  v_paid       numeric(12,2);
  v_line       record;
  v_have       integer;
  v_sku        text;
  v_cash_id    uuid;
  v_max_disc   numeric;
begin
  perform assert_role(array['superadmin', 'seller']);
  perform assert_branch_access(p_branch_id);

  if p_doc_type is null or p_doc_type not in ('factura', 'nota_venta') then
    raise exception 'Tipo de documento invalido' using errcode = 'IN003';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un producto' using errcode = 'IN003';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'Debe registrar al menos un pago' using errcode = 'IN003';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer, final_price numeric)
    where x.variant_id is null or coalesce(x.qty, 0) <= 0
       or coalesce(x.final_price, 0) <= 0 or round(x.final_price, 2) <> x.final_price
  ) then
    raise exception 'Cada producto necesita cantidad mayor a cero y precio mayor a cero (2 decimales)'
      using errcode = 'IN003';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_payments) as p(method text, amount numeric)
    where p.method is null or p.method not in ('efectivo', 'qr', 'transferencia', 'tarjeta')
       or coalesce(p.amount, 0) <= 0 or round(p.amount, 2) <> p.amount
  ) then
    raise exception 'Cada pago necesita un metodo valido y un monto mayor a cero'
      using errcode = 'IN003';
  end if;
  if (select count(distinct v.id) from variants v
      where v.active and v.id in
        (select x.variant_id from jsonb_to_recordset(p_items) as x(variant_id uuid)))
     <> (select count(distinct x.variant_id) from jsonb_to_recordset(p_items) as x(variant_id uuid)) then
    raise exception 'Algun producto no existe o esta inactivo' using errcode = 'IN005';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from customers where id = p_customer_id and active) then
    raise exception 'El cliente no existe' using errcode = 'IN005';
  end if;

  -- Discount floor (sellers only; NULL setting = no limit).
  if app_role() = 'seller' then
    select nullif(value, '')::numeric into v_max_disc
      from app_settings where key = 'max_discount_pct';
    if v_max_disc is not null and exists (
      select 1
      from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer, final_price numeric)
      join variants v on v.id = x.variant_id
      join models m on m.id = v.model_id
      where x.final_price < round(m.base_sale_price * (1 - v_max_disc / 100), 2)
    ) then
      raise exception 'El descuento supera el maximo permitido (% %%)', v_max_disc
        using errcode = 'IN003';
    end if;
  end if;

  -- The sale belongs to the branch's open cash session. The share lock keeps the session
  -- from being closed while this sale is still being written.
  select id into v_cash_id from cash_sessions
   where branch_id = p_branch_id and closed_at is null for share;
  if v_cash_id is null then
    raise exception 'No hay una caja abierta en esta sucursal' using errcode = 'IN005';
  end if;
  if p_cash_session_id is not null and p_cash_session_id <> v_cash_id then
    raise exception 'La caja indicada no es la caja abierta de esta sucursal' using errcode = 'IN005';
  end if;

  select coalesce(sum(x.qty * x.final_price), 0) into v_total
  from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer, final_price numeric);
  select coalesce(sum(p.amount), 0) into v_paid
  from jsonb_to_recordset(p_payments) as p(method text, amount numeric);

  if v_paid <> v_total then
    raise exception 'La suma de los pagos (%) no coincide con el total (%)', v_paid, v_total
      using errcode = 'IN002';
  end if;

  -- Lock stock rows in a stable order, then verify availability per variant.
  for v_line in
    select x.variant_id, sum(x.qty)::integer as need
    from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer)
    group by x.variant_id order by x.variant_id
  loop
    select qty into v_have from stock_levels
     where variant_id = v_line.variant_id and branch_id = p_branch_id for update;
    if coalesce(v_have, 0) < v_line.need then
      select sku into v_sku from variants where id = v_line.variant_id;
      raise exception 'Stock insuficiente para % (disponible %, solicitado %)',
        v_sku, coalesce(v_have, 0), v_line.need using errcode = 'IN001';
    end if;
  end loop;

  insert into sales (branch_id, cash_session_id, customer_id, seller_id, channel, doc_type, total)
  values (p_branch_id, v_cash_id, p_customer_id, app_user_id(), 'store', p_doc_type, v_total)
  returning id into v_sale_id;

  insert into sale_items (sale_id, branch_id, variant_id, qty, list_price, final_price)
  select v_sale_id, p_branch_id, x.variant_id, x.qty, m.base_sale_price, x.final_price
  from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer, final_price numeric)
  join variants v on v.id = x.variant_id
  join models m on m.id = v.model_id;

  insert into sale_payments (sale_id, branch_id, method, amount)
  select v_sale_id, p_branch_id, p.method, p.amount
  from jsonb_to_recordset(p_payments) as p(method text, amount numeric);

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, created_by)
  select x.variant_id, p_branch_id, -x.qty, 'sale', 'sales', v_sale_id, app_user_id()
  from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer);

  return v_sale_id;
end
$$;

create or replace function create_exchange(
  p_sale_id             uuid,
  p_returned_variant_id uuid,
  p_new_variant_id      uuid,
  p_qty                 integer default 1,
  p_reason              text default null,
  p_price_diff          numeric default null  -- superadmin only; others always get the computed value
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale        sales%rowtype;
  v_sold        integer;
  v_paid_unit   numeric;
  v_exchanged   integer;
  v_new_price   numeric;
  v_have        integer;
  v_diff        numeric(12,2);
  v_id          uuid;
begin
  perform assert_role(array['superadmin', 'seller']);
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'La cantidad debe ser mayor a cero' using errcode = 'IN003';
  end if;
  if p_returned_variant_id = p_new_variant_id then
    raise exception 'La variante nueva debe ser distinta a la devuelta' using errcode = 'IN003';
  end if;

  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'La venta no existe' using errcode = 'IN005';
  end if;
  perform assert_branch_access(v_sale.branch_id);
  if v_sale.status <> 'completed' then
    raise exception 'La venta esta anulada' using errcode = 'IN005';
  end if;

  select sum(qty), sum(qty * final_price) / nullif(sum(qty), 0) into v_sold, v_paid_unit
  from sale_items where sale_id = p_sale_id and variant_id = p_returned_variant_id;
  if v_sold is null then
    raise exception 'El producto devuelto no pertenece a esta venta' using errcode = 'IN005';
  end if;
  select coalesce(sum(qty), 0) into v_exchanged from exchanges
   where original_sale_id = p_sale_id and returned_variant_id = p_returned_variant_id;
  if p_qty > v_sold - v_exchanged then
    raise exception 'Solo quedan % unidades por cambiar de este producto', v_sold - v_exchanged
      using errcode = 'IN003';
  end if;

  select m.base_sale_price into v_new_price
  from variants v join models m on m.id = v.model_id
  where v.id = p_new_variant_id and v.active;
  if v_new_price is null then
    raise exception 'La variante nueva no existe o esta inactiva' using errcode = 'IN005';
  end if;

  select qty into v_have from stock_levels
   where variant_id = p_new_variant_id and branch_id = v_sale.branch_id for update;
  if coalesce(v_have, 0) < p_qty then
    raise exception 'Stock insuficiente para la variante nueva (disponible %, solicitado %)',
      coalesce(v_have, 0), p_qty using errcode = 'IN001';
  end if;

  -- Difference = (list price of the new item - price actually paid for the returned one) * qty.
  -- Only the superadmin may override it, and never beyond refunding what was paid or
  -- charging more than the new item's list price.
  if app_role() = 'superadmin' and p_price_diff is not null then
    if round(p_price_diff, 2) <> p_price_diff then
      raise exception 'La diferencia de precio admite 2 decimales' using errcode = 'IN003';
    end if;
    if p_price_diff < -round(v_paid_unit * p_qty, 2) or p_price_diff > round(v_new_price * p_qty, 2) then
      raise exception 'La diferencia de precio esta fuera de los limites permitidos' using errcode = 'IN003';
    end if;
    v_diff := p_price_diff;
  else
    v_diff := round((v_new_price - v_paid_unit) * p_qty, 2);
  end if;

  insert into exchanges
    (branch_id, original_sale_id, returned_variant_id, new_variant_id, qty, price_diff, reason, created_by)
  values
    (v_sale.branch_id, p_sale_id, p_returned_variant_id, p_new_variant_id, p_qty, v_diff,
     nullif(btrim(p_reason), ''), app_user_id())
  returning id into v_id;

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, created_by)
  values
    (p_returned_variant_id, v_sale.branch_id,  p_qty, 'exchange_in',  'exchanges', v_id, app_user_id()),
    (p_new_variant_id,      v_sale.branch_id, -p_qty, 'exchange_out', 'exchanges', v_id, app_user_id());

  return v_id;
end
$$;

create or replace function create_purchase_batch(
  p_branch_id   uuid,
  p_supplier    text,
  p_batch_date  date,
  p_rate_70     numeric,
  p_rate_30     numeric,
  p_split_pct   numeric,
  p_freight_bs  numeric,
  p_notes       text,
  p_items       jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch_id     uuid;
  v_total_units  integer;
  v_item         record;
  v_landed       numeric;
  v_onhand       integer;
  v_cost         variant_costs%rowtype;
  v_new_avg      numeric;
  v_created      integer;
begin
  perform assert_role(array['superadmin']);
  perform assert_branch_access(p_branch_id);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El lote debe tener al menos un item' using errcode = 'IN003';
  end if;
  if coalesce(p_rate_70, 0) <= 0 or coalesce(p_rate_30, 0) <= 0 then
    raise exception 'Los tipos de cambio deben ser mayores a cero' using errcode = 'IN003';
  end if;
  if p_split_pct is null or p_split_pct < 0 or p_split_pct > 100 then
    raise exception 'El porcentaje de division debe estar entre 0 y 100' using errcode = 'IN003';
  end if;
  if coalesce(p_freight_bs, 0) < 0 then
    raise exception 'El flete no puede ser negativo' using errcode = 'IN003';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer, unit_cost_usd numeric)
    where x.variant_id is null or coalesce(x.qty, 0) <= 0
       or coalesce(x.unit_cost_usd, -1) < 0 or round(x.unit_cost_usd, 2) <> x.unit_cost_usd
  ) then
    raise exception 'Cada item necesita variante, cantidad mayor a cero y costo USD valido (2 decimales)'
      using errcode = 'IN003';
  end if;
  if (select count(distinct x.variant_id) from jsonb_to_recordset(p_items) as x(variant_id uuid))
     <> jsonb_array_length(p_items) then
    raise exception 'Una variante aparece repetida en el lote' using errcode = 'IN003';
  end if;
  if (select count(*) from variants v
      where v.active and v.id in
        (select x.variant_id from jsonb_to_recordset(p_items) as x(variant_id uuid)))
     <> jsonb_array_length(p_items) then
    raise exception 'Alguna variante no existe o esta inactiva' using errcode = 'IN005';
  end if;

  select sum(x.qty) into v_total_units
  from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer);

  insert into purchase_batches
    (branch_id, supplier, batch_date, rate_70, rate_30, split_pct, freight_bs, notes, created_by)
  values
    (p_branch_id, nullif(btrim(p_supplier), ''), coalesce(p_batch_date, current_date),
     p_rate_70, p_rate_30, p_split_pct, coalesce(p_freight_bs, 0), p_notes, app_user_id())
  returning id into v_batch_id;

  -- Variants are processed in id order, so concurrent batches take their locks in the
  -- same order and cannot deadlock with each other.
  for v_item in
    select x.variant_id, x.qty, x.unit_cost_usd
    from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer, unit_cost_usd numeric)
    order by x.variant_id
  loop
    v_landed := landed_cost_bs(v_item.unit_cost_usd, p_rate_70, p_rate_30,
                               p_split_pct, coalesce(p_freight_bs, 0), v_total_units);

    insert into purchase_items
      (batch_id, branch_id, variant_id, qty, unit_cost_usd, unit_cost_bs_landed)
    values
      (v_batch_id, p_branch_id, v_item.variant_id, v_item.qty, v_item.unit_cost_usd, v_landed);

    -- 1) Take the variant_costs row lock FIRST. A concurrent first purchase waits here on
    --    the unique key and then simply finds the row (DO NOTHING) instead of failing.
    insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs)
    values (v_item.variant_id, v_landed, v_landed)
    on conflict (variant_id) do nothing;
    get diagnostics v_created = row_count;

    if v_created = 0 then
      select * into v_cost from variant_costs where variant_id = v_item.variant_id for update;
      -- 2) Only now read the stock on hand (all branches) before this purchase.
      select coalesce(sum(qty), 0) into v_onhand from stock_levels where variant_id = v_item.variant_id;
      v_new_avg := case
        when v_onhand <= 0 then v_landed
        else round((v_cost.avg_cost_bs * v_onhand + v_landed * v_item.qty)
                   / (v_onhand + v_item.qty), 2)
      end;
      update variant_costs
         set last_cost_bs = v_landed, avg_cost_bs = v_new_avg, updated_at = now()
       where variant_id = v_item.variant_id;
    end if;

    insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, created_by)
    values (v_item.variant_id, p_branch_id, v_item.qty, 'purchase', 'purchase_batches',
            v_batch_id, app_user_id());
  end loop;

  return v_batch_id;
end
$$;

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
declare
  v_ref   uuid := gen_random_uuid();
  v_have  integer;
begin
  perform assert_role(array['superadmin']);
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'La cantidad debe ser mayor a cero' using errcode = 'IN003';
  end if;
  if p_from_branch is not distinct from p_to_branch then
    raise exception 'La sucursal de origen y destino deben ser distintas' using errcode = 'IN003';
  end if;
  perform assert_branch_access(p_from_branch);
  perform assert_branch_access(p_to_branch);
  if not exists (select 1 from variants where id = p_variant_id and active) then
    raise exception 'La variante no existe o esta inactiva' using errcode = 'IN005';
  end if;

  -- Lock both stock rows in a fixed (branch_id) order. Two opposite transfers of the same
  -- variant (A->B and B->A) would otherwise each grab their own row first and deadlock.
  perform 1 from stock_levels
   where variant_id = p_variant_id and branch_id in (p_from_branch, p_to_branch)
   order by branch_id
     for update;

  select qty into v_have from stock_levels
   where variant_id = p_variant_id and branch_id = p_from_branch;
  if coalesce(v_have, 0) < p_qty then
    raise exception 'Stock insuficiente en el origen (disponible %, solicitado %)',
      coalesce(v_have, 0), p_qty using errcode = 'IN001';
  end if;

  -- Insert the movements in the same branch order too (the stock trigger locks rows).
  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, note, created_by)
  select p_variant_id, m.branch_id, m.qty, 'transfer', 'transfer', v_ref, p_note, app_user_id()
  from (values (p_from_branch, -p_qty), (p_to_branch, p_qty)) as m(branch_id, qty)
  order by m.branch_id;

  return v_ref;
end
$$;
