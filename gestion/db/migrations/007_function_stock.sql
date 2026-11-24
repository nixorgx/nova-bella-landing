-- 007: stock transfers between branches and manual adjustments (superadmin only).

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

  select qty into v_have from stock_levels
   where variant_id = p_variant_id and branch_id = p_from_branch for update;
  if coalesce(v_have, 0) < p_qty then
    raise exception 'Stock insuficiente en el origen (disponible %, solicitado %)',
      coalesce(v_have, 0), p_qty using errcode = 'IN001';
  end if;

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, note, created_by)
  values
    (p_variant_id, p_from_branch, -p_qty, 'transfer', 'transfer', v_ref, p_note, app_user_id()),
    (p_variant_id, p_to_branch,    p_qty, 'transfer', 'transfer', v_ref, p_note, app_user_id());

  return v_ref;
end
$$;

create or replace function adjust_stock(
  p_variant_id  uuid,
  p_branch_id   uuid,
  p_delta       integer,
  p_note        text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_have integer;
begin
  perform assert_role(array['superadmin']);
  perform assert_branch_access(p_branch_id);
  if coalesce(p_delta, 0) = 0 then
    raise exception 'El ajuste no puede ser cero' using errcode = 'IN003';
  end if;
  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'El motivo del ajuste es obligatorio' using errcode = 'IN003';
  end if;
  if not exists (select 1 from variants where id = p_variant_id) then
    raise exception 'La variante no existe' using errcode = 'IN005';
  end if;

  if p_delta < 0 then
    select qty into v_have from stock_levels
     where variant_id = p_variant_id and branch_id = p_branch_id for update;
    if coalesce(v_have, 0) < -p_delta then
      raise exception 'Stock insuficiente para el ajuste (disponible %)', coalesce(v_have, 0)
        using errcode = 'IN001';
    end if;
  end if;

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, note, created_by)
  values (p_variant_id, p_branch_id, p_delta, 'adjust', 'adjust', p_note, app_user_id());
end
$$;

revoke all on function transfer_stock(uuid, uuid, uuid, integer, text),
  adjust_stock(uuid, uuid, integer, text) from public;
grant execute on function transfer_stock(uuid, uuid, uuid, integer, text),
  adjust_stock(uuid, uuid, integer, text) to app_superadmin;
