-- 021 (Etapa 2): operaciones del equipo sobre los pedidos web (superadmin y, solo para pasos operativos, vendedor).
--
-- Ciclo de vida:
--   pendiente_pago -> pago_en_revision (el cliente envio comprobante o numero de transaccion)
--   pendiente_pago | pago_en_revision -> confirmado   (SOLO superadmin; crea la venta `channel = 'web'`)
--   pago_en_revision -> pendiente_pago                (SOLO superadmin: rechaza el comprobante con motivo)
--   confirmado -> en_camino (entrega) | listo_para_recoger (recojo) | entregado
--   en_camino | listo_para_recoger -> entregado
--   cualquiera (no final) -> cancelado                (SOLO superadmin, con motivo; si ya hay venta se anula)
--
-- Confirmar es una sola transaccion: bloquea las filas de stock en orden, verifica disponibilidad (si ya no hay
-- stock falla con IN001 y NO queda nada a medias), upserta el cliente por telefono, crea venta + items + pago y
-- descuenta el stock con movimientos `sale`. Es idempotente: confirmar dos veces devuelve la misma venta.
--
-- Reglas de la venta web (documentadas en README y GUIA-TIENDA):
--   * sin sesion de caja (cash_session_id NULL): no entra al efectivo esperado de ninguna caja.
--   * el total de la venta es el de los productos; el costo de envio queda en el pedido (no es ingreso de producto).
--   * pago QR -> metodo `qr`. Contra entrega -> `efectivo` provisional; al marcar "entregado" se registra el metodo real.

create or replace function web_order_confirm(p_order_id uuid) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   web_orders%rowtype;
  v_line    record;
  v_have    integer;
  v_cust    uuid;
  v_sale    uuid;
  v_sku     text;
begin
  perform assert_role(array['superadmin']);

  select * into v_order from web_orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'IN005';
  end if;
  -- doble clic / reintento: ya confirmado -> la misma venta
  if v_order.sale_id is not null then
    return v_order.sale_id;
  end if;
  if v_order.status not in ('pendiente_pago', 'pago_en_revision') then
    raise exception 'El pedido esta "%" y no se puede confirmar', v_order.status using errcode = 'IN005';
  end if;
  perform assert_branch_access(v_order.branch_id);

  for v_line in
    select i.variant_id, sum(i.qty)::integer as need
      from web_order_items i where i.order_id = v_order.id
     group by i.variant_id order by i.variant_id
  loop
    if not exists (select 1 from variants where id = v_line.variant_id and active) then
      select sku into v_sku from variants where id = v_line.variant_id;
      raise exception 'El producto % ya no esta activo. El pedido no se confirmo: contacte al cliente o cancele el pedido.', v_sku
        using errcode = 'IN005';
    end if;
    select qty into v_have from stock_levels
     where variant_id = v_line.variant_id and branch_id = v_order.branch_id for update;
    if coalesce(v_have, 0) < v_line.need then
      select sku into v_sku from variants where id = v_line.variant_id;
      raise exception 'Ya no hay stock suficiente de % (disponible %, pedido %). El pedido no se confirmo: contacte al cliente o cancele el pedido.',
        v_sku, coalesce(v_have, 0), v_line.need using errcode = 'IN001';
    end if;
  end loop;

  -- cliente: se reutiliza por telefono (ultimos 8 digitos), si no se crea uno compartido
  select c.id into v_cust from customers c
   where c.active and right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 8) = v_order.phone
   order by c.created_at limit 1;
  if v_cust is null then
    insert into customers (branch_id, name, phone, ci_nit, email, notes)
    values (null, v_order.customer_name, v_order.phone, v_order.invoice_nit, v_order.email, 'Cliente de la tienda web')
    returning id into v_cust;
  end if;

  insert into sales (branch_id, cash_session_id, customer_id, seller_id, channel, doc_type, total)
  values (v_order.branch_id, null, v_cust, app_user_id(), 'web',
          case when v_order.wants_invoice then 'factura' else 'nota_venta' end, v_order.subtotal)
  returning id into v_sale;

  insert into sale_items (sale_id, branch_id, variant_id, qty, list_price, final_price)
  select v_sale, v_order.branch_id, i.variant_id, i.qty, i.unit_price, i.unit_price
    from web_order_items i where i.order_id = v_order.id;

  insert into sale_payments (sale_id, branch_id, method, amount)
  values (v_sale, v_order.branch_id,
          case v_order.payment_method when 'qr' then 'qr' else 'efectivo' end, v_order.subtotal);

  insert into stock_movements (variant_id, branch_id, qty, type, ref_table, ref_id, note, created_by)
  select i.variant_id, v_order.branch_id, -i.qty, 'sale', 'sales', v_sale, v_order.code, app_user_id()
    from web_order_items i where i.order_id = v_order.id;

  update web_orders
     set status = 'confirmado', sale_id = v_sale, customer_id = v_cust,
         confirmed_at = now(), confirmed_by = app_user_id(), reject_reason = null, updated_at = now()
   where id = v_order.id;
  perform web_order_event(v_order.id, 'admin', v_order.status, 'confirmado',
    case v_order.payment_method when 'qr' then 'Pago confirmado' else 'Pedido confirmado (pago contra entrega)' end);
  return v_sale;
end
$$;

create or replace function web_order_reject_proof(p_order_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order web_orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform assert_role(array['superadmin']);
  if length(v_reason) < 5 or length(v_reason) > 300 then
    raise exception 'Escriba el motivo del rechazo (5 a 300 caracteres)' using errcode = 'IN003';
  end if;
  select * into v_order from web_orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'IN005';
  end if;
  if v_order.status <> 'pago_en_revision' then
    raise exception 'Solo se puede rechazar un comprobante de un pedido en revision' using errcode = 'IN005';
  end if;
  update web_orders set status = 'pendiente_pago', reject_reason = v_reason, updated_at = now() where id = v_order.id;
  perform web_order_event(v_order.id, 'admin', 'pago_en_revision', 'pendiente_pago', 'Comprobante rechazado: ' || v_reason);
end
$$;

-- Pasos operativos: en_camino / listo_para_recoger / entregado. Vendedor solo en pedidos de SU sucursal.
create or replace function web_order_set_status(p_order_id uuid, p_status text, p_collected_method text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order web_orders%rowtype;
begin
  perform assert_role(array['superadmin', 'seller']);
  if p_status is null or p_status not in ('en_camino', 'listo_para_recoger', 'entregado') then
    raise exception 'Estado no permitido' using errcode = 'IN003';
  end if;
  select * into v_order from web_orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'IN005';
  end if;
  if app_role() = 'seller' and v_order.branch_id is distinct from app_branch_id() then
    raise exception 'No puede operar pedidos de otra sucursal' using errcode = 'IN004';
  end if;
  if v_order.status = p_status then
    return;  -- doble clic
  end if;
  if v_order.status not in ('confirmado', 'en_camino', 'listo_para_recoger') then
    raise exception 'El pedido esta "%": primero debe confirmarse el pago', v_order.status using errcode = 'IN005';
  end if;
  if p_status = 'en_camino' and (v_order.fulfillment <> 'delivery' or v_order.status <> 'confirmado') then
    raise exception 'Solo un pedido confirmado con entrega a domicilio puede ir "en camino"' using errcode = 'IN005';
  end if;
  if p_status = 'listo_para_recoger' and (v_order.fulfillment <> 'pickup' or v_order.status <> 'confirmado') then
    raise exception 'Solo un pedido confirmado con recojo en tienda puede estar "listo para recoger"' using errcode = 'IN005';
  end if;
  if p_status = 'entregado' and v_order.payment_method = 'contra_entrega' then
    if p_collected_method is null or p_collected_method not in ('efectivo', 'qr', 'transferencia', 'tarjeta') then
      raise exception 'Indique como pago el cliente al recibir (efectivo, QR, transferencia o tarjeta)' using errcode = 'IN003';
    end if;
    update sale_payments set method = p_collected_method where sale_id = v_order.sale_id;
  end if;

  update web_orders
     set status = p_status, updated_at = now(),
         shipped_at = case when p_status in ('en_camino', 'listo_para_recoger') then now() else shipped_at end,
         delivered_at = case when p_status = 'entregado' then now() else delivered_at end,
         collected_method = case when p_status = 'entregado' and payment_method = 'contra_entrega'
                                 then p_collected_method else collected_method end
   where id = v_order.id;
  perform web_order_event(v_order.id, case when app_role() = 'seller' then 'seller' else 'admin' end,
                          v_order.status, p_status, null);
end
$$;

create or replace function web_order_cancel(p_order_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order web_orders%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform assert_role(array['superadmin']);
  if length(v_reason) < 5 or length(v_reason) > 300 then
    raise exception 'Escriba el motivo de la cancelacion (5 a 300 caracteres)' using errcode = 'IN003';
  end if;
  select * into v_order from web_orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'IN005';
  end if;
  if v_order.status = 'cancelado' then
    return;
  end if;
  if v_order.status = 'entregado' then
    raise exception 'Un pedido entregado no se cancela: registre un cambio o anule la venta desde Ventas' using errcode = 'IN005';
  end if;
  if v_order.sale_id is not null then
    -- la venta se anula (stock vuelve con movimientos `void`); el disparador marca el pedido como cancelado
    perform void_sale(v_order.sale_id, v_reason);
  end if;
  update web_orders
     set status = 'cancelado', cancel_reason = v_reason,
         cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
   where id = v_order.id;
  if v_order.sale_id is null then
    perform web_order_event(v_order.id, 'admin', v_order.status, 'cancelado', v_reason);
  end if;
end
$$;

-- Si alguien anula la venta desde Ventas, el pedido queda cancelado (nunca "confirmado" sin venta vigente).
create or replace function web_orders_on_sale_void() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order web_orders%rowtype;
begin
  if new.status = 'voided' and old.status <> 'voided' then
    select * into v_order from web_orders where sale_id = new.id for update;
    if found and v_order.status <> 'cancelado' then
      update web_orders
         set status = 'cancelado', cancel_reason = left('Venta anulada: ' || coalesce(new.void_reason, ''), 300),
             cancelled_at = now(), updated_at = now()
       where id = v_order.id;
      insert into web_order_events (order_id, actor_id, actor_kind, from_status, to_status, note)
      values (v_order.id, new.voided_by, 'admin', v_order.status, 'cancelado', left('Venta anulada: ' || coalesce(new.void_reason, ''), 300));
    end if;
  end if;
  return new;
end
$$;

create trigger web_orders_on_sale_void after update of status on sales
  for each row execute function web_orders_on_sale_void();

alter function web_order_confirm(uuid) owner to app_definer;
alter function web_order_reject_proof(uuid, text) owner to app_definer;
alter function web_order_set_status(uuid, text, text) owner to app_definer;
alter function web_order_cancel(uuid, text) owner to app_definer;
alter function web_orders_on_sale_void() owner to app_definer;

revoke all on function web_order_confirm(uuid), web_order_reject_proof(uuid, text), web_order_set_status(uuid, text, text),
  web_order_cancel(uuid, text), web_orders_on_sale_void() from public;
grant execute on function web_order_confirm(uuid), web_order_reject_proof(uuid, text), web_order_cancel(uuid, text)
  to app_superadmin;
grant execute on function web_order_set_status(uuid, text, text) to app_superadmin, app_seller;
