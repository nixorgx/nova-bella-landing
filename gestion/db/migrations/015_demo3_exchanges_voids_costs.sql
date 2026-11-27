-- 015 (Demo 3): exchanges that settle money, void reasons, and cost snapshots for reports.
--
--  * exchanges: how the price difference was collected / refunded (payment_method), the cash
--    session it went through, the price actually paid for the returned unit and a group id so
--    several lines confirmed together print on one receipt.
--  * create_exchange: requires the payment method when money moves and an OPEN cash session
--    in the branch (the money goes through the drawer / bank of that session).
--  * void_sale: a reason (>= 5 characters) is mandatory.
--  * sale_item_costs / exchange_costs: unit cost snapshot (weighted average at the moment of the
--    sale / exchange) so profit reports do not move when later purchases change the average.
--    Superadmin-only tables: sellers have no GRANT and no policy (same wall as variant_costs).
--    Sales and exchanges created before this migration are backfilled with the CURRENT average
--    (best available approximation, documented in the README).

-- ---- exchanges: settlement + cash session + price snapshot ----
alter table exchanges
  add column payment_method       text check (payment_method in ('efectivo', 'qr', 'transferencia', 'tarjeta')),
  add column cash_session_id      uuid references cash_sessions (id),
  add column returned_unit_price  numeric(12,2),
  add column group_id             uuid;

create index exchanges_cash_session_idx on exchanges (cash_session_id);
create index exchanges_group_idx on exchanges (group_id);
create index exchanges_created_idx on exchanges (branch_id, created_at desc);
create index sales_seller_created_idx on sales (seller_id, created_at desc);

-- Rows created before this migration are not forced to carry a method (NOT VALID checks new rows only).
alter table exchanges add constraint exchanges_settlement_check
  check (price_diff = 0 or payment_method is not null) not valid;

update exchanges e
   set returned_unit_price = round(
         (select sum(si.qty * si.final_price) / nullif(sum(si.qty), 0)
            from sale_items si
           where si.sale_id = e.original_sale_id and si.variant_id = e.returned_variant_id), 2),
       group_id = e.id;

-- ---- cost snapshots (superadmin only) ----
create table sale_item_costs (
  sale_item_id  uuid primary key references sale_items (id),
  unit_cost_bs  numeric(14,4) not null check (unit_cost_bs >= 0)
);

create table exchange_costs (
  exchange_id            uuid primary key references exchanges (id),
  returned_unit_cost_bs  numeric(14,4) not null check (returned_unit_cost_bs >= 0),
  new_unit_cost_bs       numeric(14,4) not null check (new_unit_cost_bs >= 0)
);

alter table sale_item_costs enable row level security;
alter table exchange_costs  enable row level security;
create policy superadmin_read on sale_item_costs for select to app_superadmin using (true);
create policy superadmin_read on exchange_costs  for select to app_superadmin using (true);

revoke all on sale_item_costs, exchange_costs from public;
grant select on sale_item_costs, exchange_costs to app_superadmin, app_definer;
grant insert on sale_item_costs, exchange_costs to app_definer;

create trigger sale_item_costs_no_delete before delete on sale_item_costs
  for each row execute function block_row_delete();
create trigger exchange_costs_no_delete before delete on exchange_costs
  for each row execute function block_row_delete();

create or replace function sale_items_snapshot_cost() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into sale_item_costs (sale_item_id, unit_cost_bs)
  select new.id, vc.avg_cost_bs from variant_costs vc where vc.variant_id = new.variant_id
  on conflict do nothing;
  return new;
end
$$;

create or replace function exchanges_snapshot_cost() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_returned numeric;
  v_new      numeric;
begin
  select sum(sic.unit_cost_bs * si.qty) / nullif(sum(si.qty), 0) into v_returned
    from sale_items si join sale_item_costs sic on sic.sale_item_id = si.id
   where si.sale_id = new.original_sale_id and si.variant_id = new.returned_variant_id;
  if v_returned is null then
    select avg_cost_bs into v_returned from variant_costs where variant_id = new.returned_variant_id;
  end if;
  select avg_cost_bs into v_new from variant_costs where variant_id = new.new_variant_id;
  insert into exchange_costs (exchange_id, returned_unit_cost_bs, new_unit_cost_bs)
  values (new.id, coalesce(v_returned, 0), coalesce(v_new, 0))
  on conflict do nothing;
  return new;
end
$$;

alter function sale_items_snapshot_cost() owner to app_definer;
alter function exchanges_snapshot_cost() owner to app_definer;
revoke all on function sale_items_snapshot_cost(), exchanges_snapshot_cost() from public;

create trigger sale_items_cost_snapshot after insert on sale_items
  for each row execute function sale_items_snapshot_cost();
create trigger exchanges_cost_snapshot after insert on exchanges
  for each row execute function exchanges_snapshot_cost();

-- backfill (current average cost; see header)
insert into sale_item_costs (sale_item_id, unit_cost_bs)
select si.id, vc.avg_cost_bs
  from sale_items si join variant_costs vc on vc.variant_id = si.variant_id
on conflict do nothing;

insert into exchange_costs (exchange_id, returned_unit_cost_bs, new_unit_cost_bs)
select e.id,
       coalesce((select sum(sic.unit_cost_bs * si.qty) / nullif(sum(si.qty), 0)
                   from sale_items si join sale_item_costs sic on sic.sale_item_id = si.id
                  where si.sale_id = e.original_sale_id and si.variant_id = e.returned_variant_id),
                (select avg_cost_bs from variant_costs where variant_id = e.returned_variant_id), 0),
       coalesce((select avg_cost_bs from variant_costs where variant_id = e.new_variant_id), 0)
  from exchanges e
on conflict do nothing;

-- ---- create_exchange v2 (same rules as 012, plus settlement) ----
drop function create_exchange(uuid, uuid, uuid, integer, text, numeric);

create or replace function create_exchange(
  p_sale_id             uuid,
  p_returned_variant_id uuid,
  p_new_variant_id      uuid,
  p_qty                 integer default 1,
  p_reason              text default null,
  p_price_diff          numeric default null,   -- superadmin only; others always get the computed value
  p_payment_method      text default null,      -- required when the difference is not zero
  p_group_id            uuid default null       -- lines confirmed together share one receipt
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
  v_session     uuid;
  v_id          uuid := gen_random_uuid();
begin
  perform assert_role(array['superadmin', 'seller']);
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'La cantidad debe ser mayor a cero' using errcode = 'IN003';
  end if;
  if p_returned_variant_id = p_new_variant_id then
    raise exception 'La variante nueva debe ser distinta a la devuelta' using errcode = 'IN003';
  end if;
  if p_payment_method is not null and p_payment_method not in ('efectivo', 'qr', 'transferencia', 'tarjeta') then
    raise exception 'Metodo de pago no valido' using errcode = 'IN003';
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

  select id into v_session from cash_sessions where branch_id = v_sale.branch_id and closed_at is null;
  if v_diff <> 0 then
    if p_payment_method is null then
      raise exception 'Indique como se cobra o devuelve la diferencia (efectivo, QR, transferencia o tarjeta)'
        using errcode = 'IN003';
    end if;
    if v_session is null then
      raise exception 'Abra la caja de la sucursal antes de cobrar o devolver una diferencia' using errcode = 'IN005';
    end if;
  end if;

  insert into exchanges
    (id, branch_id, original_sale_id, returned_variant_id, new_variant_id, qty, price_diff, reason, created_by,
     payment_method, cash_session_id, returned_unit_price, group_id)
  values
    (v_id, v_sale.branch_id, p_sale_id, p_returned_variant_id, p_new_variant_id, p_qty, v_diff,
     nullif(btrim(p_reason), ''), app_user_id(),
     case when v_diff = 0 then null else p_payment_method end, v_session, round(v_paid_unit, 2),
     coalesce(p_group_id, v_id));

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, created_by)
  values
    (p_returned_variant_id, v_sale.branch_id,  p_qty, 'exchange_in',  'exchanges', v_id, app_user_id()),
    (p_new_variant_id,      v_sale.branch_id, -p_qty, 'exchange_out', 'exchanges', v_id, app_user_id());

  return v_id;
end
$$;

alter function create_exchange(uuid, uuid, uuid, integer, text, numeric, text, uuid) owner to app_definer;
revoke all on function create_exchange(uuid, uuid, uuid, integer, text, numeric, text, uuid) from public;
grant execute on function create_exchange(uuid, uuid, uuid, integer, text, numeric, text, uuid)
  to app_superadmin, app_seller;

-- exchanges are written only by create_exchange (definer); the cost snapshot trigger runs as definer too
grant insert on exchanges to app_definer;

-- ---- void_sale: reason is mandatory ----
create or replace function void_sale(p_sale_id uuid, p_reason text default null) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale  sales%rowtype;
begin
  perform assert_role(array['superadmin']);
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indique el motivo de la anulacion (minimo 5 caracteres)' using errcode = 'IN003';
  end if;

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
         void_reason = btrim(p_reason)
   where id = p_sale_id;

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, created_by)
  select si.variant_id, si.branch_id, si.qty, 'void', 'sales', p_sale_id, app_user_id()
  from sale_items si where si.sale_id = p_sale_id;
end
$$;
