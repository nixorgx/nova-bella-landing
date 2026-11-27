-- 006: sales, exchanges and voids as transactional RPCs.
-- Stock is only ever changed by inserting stock_movements; sales are voided, never deleted.

create or replace function create_sale(
  p_branch_id        uuid,
  p_customer_id      uuid,
  p_doc_type         text,
  p_items            jsonb,   -- [{variant_id, qty, final_price}]
  p_payments         jsonb,   -- [{method, amount}]
  p_cash_session_id  uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale_id   uuid;
  v_total     numeric(12,2);
  v_paid      numeric(12,2);
  v_line      record;
  v_have      integer;
  v_sku       text;
begin
  perform assert_role(array['superadmin', 'seller']);
  perform assert_branch_access(p_branch_id);

  if p_doc_type is null or p_doc_type not in ('factura', 'nota_venta') then
    raise exception 'Tipo de documento invalido' using errcode = 'IN003';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe tener al menos un producto' using errcode = 'IN003';
  end if;
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Los pagos son obligatorios' using errcode = 'IN003';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(variant_id uuid, qty integer, final_price numeric)
    where x.variant_id is null or coalesce(x.qty, 0) <= 0
       or coalesce(x.final_price, -1) < 0 or round(x.final_price, 2) <> x.final_price
  ) then
    raise exception 'Cada producto necesita cantidad mayor a cero y precio valido (2 decimales)'
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
  if p_cash_session_id is not null and not exists (
    select 1 from cash_sessions
    where id = p_cash_session_id and branch_id = p_branch_id and closed_at is null
  ) then
    raise exception 'La caja no esta abierta en esta sucursal' using errcode = 'IN005';
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
  values (p_branch_id, p_cash_session_id, p_customer_id, app_user_id(), 'store', p_doc_type, v_total)
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
  p_price_diff          numeric default null  -- null = new list price - price actually paid
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

  v_diff := coalesce(p_price_diff, round((v_new_price - v_paid_unit) * p_qty, 2));

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

create or replace function void_sale(p_sale_id uuid, p_reason text default null) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale  sales%rowtype;
begin
  perform assert_role(array['superadmin']);

  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'La venta no existe' using errcode = 'IN005';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'La venta ya esta anulada' using errcode = 'IN005';
  end if;
  if exists (select 1 from exchanges where original_sale_id = p_sale_id) then
    raise exception 'La venta tiene cambios registrados y no puede anularse' using errcode = 'IN005';
  end if;

  update sales
     set status = 'voided', voided_at = now(), voided_by = app_user_id(),
         void_reason = nullif(btrim(p_reason), '')
   where id = p_sale_id;

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, created_by)
  select si.variant_id, si.branch_id, si.qty, 'void', 'sales', p_sale_id, app_user_id()
  from sale_items si where si.sale_id = p_sale_id;
end
$$;

revoke all on function
  create_sale(uuid, uuid, text, jsonb, jsonb, uuid),
  create_exchange(uuid, uuid, uuid, integer, text, numeric),
  void_sale(uuid, text)
  from public;
grant execute on function
  create_sale(uuid, uuid, text, jsonb, jsonb, uuid),
  create_exchange(uuid, uuid, uuid, integer, text, numeric)
  to app_superadmin, app_seller;
grant execute on function void_sale(uuid, text) to app_superadmin;
