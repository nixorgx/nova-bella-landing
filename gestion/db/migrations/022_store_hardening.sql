-- 022 (Etapa 2): endurecimiento tras la revision de seguridad.
--
--  * web_orders_expire_unpaid: la superadmin cancela de una vez los pedidos sin pagar (pendiente_pago, sin comprobante)
--    mas viejos que N dias, para limpiar spam o pedidos abandonados. No hay reserva de stock, asi que solo es orden.
--  * Nadie (ni PUBLIC) puede crear objetos en el esquema public: las funciones publicas usan search_path con `public`.

revoke create on schema public from public;

create or replace function web_orders_expire_unpaid(p_days integer) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform assert_role(array['superadmin']);
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Indique entre 1 y 365 dias' using errcode = 'IN003';
  end if;
  with expired as (
    update web_orders
       set status = 'cancelado', cancel_reason = 'Vencido sin pago', cancelled_at = now(), updated_at = now()
     where status = 'pendiente_pago' and proof_count = 0 and payment_reference is null
       and created_at < now() - make_interval(days => p_days)
    returning id
  )
  insert into web_order_events (order_id, actor_id, actor_kind, from_status, to_status, note)
  select id, app_user_id(), 'admin', 'pendiente_pago', 'cancelado', 'Vencido sin pago' from expired;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

alter function web_orders_expire_unpaid(integer) owner to app_definer;
revoke all on function web_orders_expire_unpaid(integer) from public;
grant execute on function web_orders_expire_unpaid(integer) to app_superadmin;
