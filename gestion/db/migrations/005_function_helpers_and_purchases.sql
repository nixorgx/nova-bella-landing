-- 005: guards + landed cost + purchase batches.
-- All RPCs are SECURITY DEFINER with a pinned search_path and explicit role checks
-- (they bypass RLS as owner, so every branch/role rule is re-checked here).

create or replace function assert_role(p_allowed text[]) returns void
language plpgsql stable
as $$
begin
  if app_role() is null or app_user_id() is null or not (app_role() = any (p_allowed)) then
    raise exception 'No tiene permiso para realizar esta operacion'
      using errcode = 'IN004';
  end if;
end
$$;

-- Seller may only act on the branch in their session; superadmin on any active branch.
create or replace function assert_branch_access(p_branch_id uuid) returns void
language plpgsql stable
set search_path = public, pg_temp
as $$
begin
  if p_branch_id is null then
    raise exception 'La sucursal es obligatoria' using errcode = 'IN003';
  end if;
  if app_role() = 'seller' and p_branch_id is distinct from app_branch_id() then
    raise exception 'No puede operar en otra sucursal' using errcode = 'IN004';
  end if;
  if not exists (select 1 from branches where id = p_branch_id and active) then
    raise exception 'La sucursal no existe o esta inactiva' using errcode = 'IN005';
  end if;
end
$$;

-- Landed cost per unit in Bs. Mirrors lib/costing.ts calculateLandedCost():
--   usd * (split/100 * rate_70 + (1 - split/100) * rate_30) + freight / total_units,
-- rounded half-up to 2 decimals once, at the end.
create or replace function landed_cost_bs(
  p_unit_cost_usd numeric, p_rate_70 numeric, p_rate_30 numeric,
  p_split_pct numeric, p_freight_bs numeric, p_total_units integer
) returns numeric
language sql immutable
as $$
  select round(
    p_unit_cost_usd * (p_split_pct / 100 * p_rate_70 + (1 - p_split_pct / 100) * p_rate_30)
    + p_freight_bs / p_total_units,
    2)
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

    -- Moving weighted average over the stock on hand (all branches) before this purchase.
    select coalesce(sum(qty), 0) into v_onhand from stock_levels where variant_id = v_item.variant_id;
    select * into v_cost from variant_costs where variant_id = v_item.variant_id for update;

    if not found then
      insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs)
      values (v_item.variant_id, v_landed, v_landed);
    else
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

revoke all on function assert_role(text[]), assert_branch_access(uuid),
  landed_cost_bs(numeric, numeric, numeric, numeric, numeric, integer),
  create_purchase_batch(uuid, text, date, numeric, numeric, numeric, numeric, text, jsonb)
  from public;
grant execute on function assert_role(text[]), assert_branch_access(uuid)
  to app_superadmin, app_seller;
grant execute on function landed_cost_bs(numeric, numeric, numeric, numeric, numeric, integer)
  to app_superadmin;
grant execute on function create_purchase_batch(uuid, text, date, numeric, numeric, numeric, numeric, text, jsonb)
  to app_superadmin;
