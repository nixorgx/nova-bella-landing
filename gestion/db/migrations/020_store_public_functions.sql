-- 020 (Etapa 2): superficie publica de la tienda.
--
-- El login anonimo `app_runtime_public` no tiene ningun privilegio sobre tablas. Solo ejecuta las
-- funciones public_* de abajo: SECURITY DEFINER, dueñas de app_definer, search_path fijo, sin EXECUTE
-- para PUBLIC. Devuelven unicamente columnas seguras (nunca costos, usuarios, otros clientes ni
-- comprobantes) y trabajan con el token de un pedido (se guarda su SHA-256, nunca el token).
--
-- Disponibilidad: stock_levels de la sucursal web (`store_web_branch()`), mostrado como maximo 10.

-- Las imagenes y comprobantes deben ser WebP (RIFF....WEBP) aunque alguien llegue a la base.
alter table model_images add constraint model_images_webp check (
  substring(full_bytes from 1 for 4) = '\x52494646'::bytea and substring(full_bytes from 9 for 4) = '\x57454250'::bytea
  and substring(thumb_bytes from 1 for 4) = '\x52494646'::bytea and substring(thumb_bytes from 9 for 4) = '\x57454250'::bytea
);
alter table store_assets add constraint store_assets_webp check (
  substring(bytes from 1 for 4) = '\x52494646'::bytea and substring(bytes from 9 for 4) = '\x57454250'::bytea
);
alter table web_order_proofs add constraint web_order_proofs_webp check (
  substring(bytes from 1 for 4) = '\x52494646'::bytea and substring(bytes from 9 for 4) = '\x57454250'::bytea
);

-- ---- helpers ----
create or replace function store_web_branch() returns uuid
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (select b.id from branches b
      where b.active and b.id::text = (select s.value from app_settings s where s.key = 'store_branch_id')),
    (select b.id from branches b where b.active order by b.created_at, b.name limit 1))
$$;

create or replace function store_setting(p_key text) returns text
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select nullif(btrim(s.value), '') from app_settings s where s.key = p_key
$$;

create or replace function web_order_event(
  p_order_id uuid, p_kind text, p_from text, p_to text, p_note text default null
) returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  insert into web_order_events (order_id, actor_id, actor_kind, from_status, to_status, note)
  values (p_order_id, app_user_id(), p_kind, p_from, p_to, left(p_note, 300))
$$;

-- ---- limitador de intentos compartido (reutiliza auth_reserve_attempt con otro prefijo) ----
create or replace function public_reserve_attempt(p_key text, p_max integer, p_window_seconds integer)
returns table (allowed boolean, retry_after_seconds integer)
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select * from auth_reserve_attempt('pub:' || coalesce(left(p_key, 150), ''), p_max, p_window_seconds)
$$;

-- ---- datos de la tienda ----
create or replace function public_store_info() returns jsonb
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'open', store_setting('store_open') = 'true' and store_web_branch() is not null,
    'whatsapp', store_setting('store_whatsapp'),
    'bank_instructions', store_setting('store_bank_instructions'),
    'policy_exchange', store_setting('store_policy_exchange'),
    'policy_shipping', store_setting('store_policy_shipping'),
    'has_qr', exists (select 1 from store_assets where key = 'payment_qr'),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'description', z.description, 'fee', z.fee)
                       order by z.sort_order, z.name)
        from store_delivery_zones z where z.active), '[]'::jsonb),
    'pickup', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'address', p.address, 'hours', p.hours)
                       order by p.sort_order, p.label)
        from store_pickup_points p join branches b on b.id = p.branch_id
       where p.active and b.active), '[]'::jsonb)
  )
$$;

-- ---- catalogo ----
create or replace function public_catalog_list() returns jsonb
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with branch as (select store_web_branch() as id),
  pubm as (
    select m.id, m.slug, m.name, m.description, m.base_sale_price, m.line_id, l.name as line_name
      from models m join product_lines l on l.id = m.line_id
     where m.published_online and m.active and l.active and m.base_sale_price > 0
  ),
  vs as (
    select v.model_id, v.color_id, v.size_id, least(coalesce(sl.qty, 0), 10)::int as cap
      from variants v
      join pubm on pubm.id = v.model_id
      left join stock_levels sl on sl.variant_id = v.id and sl.branch_id = (select id from branch)
     where v.active
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'name', p.name, 'line_id', p.line_id, 'line', p.line_name,
      'description', p.description, 'price', p.base_sale_price,
      'image', img.id, 'image_w', img.thumb_width, 'image_h', img.thumb_height,
      'units', coalesce((select sum(vs.cap) from vs where vs.model_id = p.id), 0),
      'colors', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex, 'avail', c.avail) order by c.name)
          from (select co.id, co.name, co.hex, bool_or(vs.cap > 0) as avail
                  from vs join colors co on co.id = vs.color_id
                 where vs.model_id = p.id group by co.id, co.name, co.hex) c), '[]'::jsonb),
      'sizes', coalesce((
        select jsonb_agg(jsonb_build_object('id', z.id, 'label', z.label, 'avail', z.avail) order by z.sort_order, z.label)
          from (select sz.id, sz.label, sz.sort_order, bool_or(vs.cap > 0) as avail
                  from vs join sizes sz on sz.id = vs.size_id
                 where vs.model_id = p.id group by sz.id, sz.label, sz.sort_order) z), '[]'::jsonb),
      'pairs', coalesce((
        select jsonb_agg(left(vs.color_id::text, 8) || '|' || left(vs.size_id::text, 8) || '|' || case when vs.cap > 0 then '1' else '0' end)
          from vs where vs.model_id = p.id), '[]'::jsonb)
    ) order by p.line_name, p.name), '[]'::jsonb)
  from pubm p
  left join lateral (
    select i.id, i.thumb_width, i.thumb_height from model_images i
     where i.model_id = p.id
     order by (i.color_id is null) desc, i.position, i.created_at limit 1) img on true
$$;

create or replace function public_product(p_slug text) returns jsonb
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with branch as (select store_web_branch() as id),
  m as (
    select m.id, m.slug, m.name, m.description, m.base_sale_price, m.line_id, l.name as line_name
      from models m join product_lines l on l.id = m.line_id
     where m.slug = left(p_slug, 120) and m.published_online and m.active and l.active and m.base_sale_price > 0
  ),
  vs as (
    select v.id, v.color_id, v.size_id, least(coalesce(sl.qty, 0), 10)::int as cap
      from variants v join m on m.id = v.model_id
      left join stock_levels sl on sl.variant_id = v.id and sl.branch_id = (select id from branch)
     where v.active
  )
  select jsonb_build_object(
    'id', m.id, 'slug', m.slug, 'name', m.name, 'line', m.line_name, 'description', m.description,
    'price', m.base_sale_price,
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'color_id', i.color_id, 'alt', i.alt,
               'w', i.full_width, 'h', i.full_height, 'tw', i.thumb_width, 'th', i.thumb_height)
             order by i.position, i.created_at)
        from model_images i where i.model_id = m.id), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'hex', c.hex) order by c.name)
        from (select distinct co.id, co.name, co.hex from vs join colors co on co.id = vs.color_id) c), '[]'::jsonb),
    'sizes', coalesce((
      select jsonb_agg(jsonb_build_object('id', z.id, 'label', z.label) order by z.sort_order, z.label)
        from (select distinct sz.id, sz.label, sz.sort_order from vs join sizes sz on sz.id = vs.size_id) z), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object('id', vs.id, 'color_id', vs.color_id, 'size_id', vs.size_id, 'cap', vs.cap))
        from vs), '[]'::jsonb)
  )
  from m
$$;

-- Detalle de las lineas del carrito (el cliente solo manda variant_id + qty; precio y stock salen de aqui).
create or replace function public_cart_lines(p_lines jsonb) returns jsonb
language plpgsql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_branch uuid := store_web_branch();
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 30 then
    raise exception 'Carrito no valido' using errcode = 'IN003';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'variant_id', v.id, 'slug', m.slug, 'model', m.name, 'color', c.name, 'color_hex', c.hex,
        'size', s.label, 'price', m.base_sale_price,
        'cap', least(coalesce(sl.qty, 0), 10)::int,
        'image', (select i.id from model_images i where i.model_id = m.id
                   order by (i.color_id = v.color_id) desc nulls last, (i.color_id is null) desc, i.position, i.created_at limit 1)
      ) order by m.name, c.name, s.sort_order)
      from (select distinct x.variant_id from jsonb_to_recordset(p_lines) as x(variant_id uuid)) q
      join variants v on v.id = q.variant_id and v.active
      join models m on m.id = v.model_id and m.active and m.published_online and m.base_sale_price > 0
      join colors c on c.id = v.color_id
      join sizes s on s.id = v.size_id
      left join stock_levels sl on sl.variant_id = v.id and sl.branch_id = v_branch
  ), '[]'::jsonb);
end
$$;

-- ---- imagenes publicas (solo de modelos publicados) ----
create or replace function public_image(p_id uuid, p_size text)
returns table (bytes bytea, content_type text, etag text)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case when p_size = 'thumb' then i.thumb_bytes else i.full_bytes end, i.content_type,
         i.etag || case when p_size = 'thumb' then 't' else 'f' end
    from model_images i join models m on m.id = i.model_id
   where i.id = p_id and m.published_online and m.active
$$;

-- ---- pedidos ----
create or replace function public_create_order(p_payload jsonb, p_token_hash bytea)
returns table (order_code text, order_status text, was_created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_idem      text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
  v_existing  web_orders%rowtype;
  v_branch    uuid := store_web_branch();
  v_name      text := btrim(coalesce(p_payload->>'name', ''));
  v_phone     text := coalesce(p_payload->>'phone', '');
  v_email     text := nullif(btrim(coalesce(p_payload->>'email', '')), '');
  v_pay       text := p_payload->>'payment_method';
  v_ful       text := p_payload->>'fulfillment';
  v_wants     boolean := coalesce(p_payload->>'wants_invoice', 'false') = 'true';
  v_nit       text := nullif(btrim(coalesce(p_payload->>'invoice_nit', '')), '');
  v_inv_name  text := nullif(btrim(coalesce(p_payload->>'invoice_name', '')), '');
  v_notes     text := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
  v_address   text := nullif(btrim(coalesce(p_payload->>'address', '')), '');
  v_reference text := nullif(btrim(coalesce(p_payload->>'reference', '')), '');
  v_zone      store_delivery_zones%rowtype;
  v_pickup_branch uuid;
  v_pickup_label  text;
  v_line      record;
  v_subtotal  numeric(12,2) := 0;
  v_fee       numeric(12,2) := 0;
  v_order_id  uuid;
  v_code      text;
  v_chars     constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_items     jsonb := p_payload->'items';
  v_count     integer;
  v_pending   integer;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'Solicitud no valida' using errcode = 'IN003';
  end if;
  if v_idem is null or length(v_idem) not between 16 and 80 then
    raise exception 'Solicitud no valida' using errcode = 'IN003';
  end if;

  -- Reintento del mismo envio (doble clic, recarga): se devuelve el pedido ya creado.
  select * into v_existing from web_orders where idempotency_key = v_idem;
  if found then
    return query select v_existing.code, v_existing.status, false;
    return;
  end if;

  if store_setting('store_open') is distinct from 'true' or v_branch is null then
    raise exception 'La tienda no esta recibiendo pedidos en este momento. Intente mas tarde o escribanos por WhatsApp.'
      using errcode = 'IN005';
  end if;

  if length(v_name) not between 2 and 80 then
    raise exception 'Escriba su nombre completo (2 a 80 caracteres)' using errcode = 'IN003';
  end if;
  if v_phone !~ '^[0-9]{8}$' then
    raise exception 'El telefono debe tener 8 digitos' using errcode = 'IN003';
  end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'El correo no es valido' using errcode = 'IN003';
  end if;
  if v_pay is null or v_pay not in ('qr', 'contra_entrega') then
    raise exception 'Elija un metodo de pago' using errcode = 'IN003';
  end if;
  if v_ful is null or v_ful not in ('delivery', 'pickup') then
    raise exception 'Elija entrega a domicilio o recojo en tienda' using errcode = 'IN003';
  end if;
  if v_notes is not null and length(v_notes) > 300 then
    raise exception 'La nota es demasiado larga' using errcode = 'IN003';
  end if;
  if v_wants and (v_nit is null or v_inv_name is null or v_nit !~ '^[0-9A-Za-z.-]{3,20}$' or length(v_inv_name) > 120) then
    raise exception 'Para la factura indique NIT/CI y razon social' using errcode = 'IN003';
  end if;

  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'El carrito esta vacio' using errcode = 'IN003';
  end if;
  if jsonb_array_length(v_items) > 30 then
    raise exception 'El carrito admite como maximo 30 productos distintos' using errcode = 'IN003';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_items) as x(variant_id uuid, qty integer)
    where x.variant_id is null or coalesce(x.qty, 0) not between 1 and 10
  ) then
    raise exception 'Cada producto admite entre 1 y 10 unidades' using errcode = 'IN003';
  end if;

  -- Frena los envios masivos del mismo telefono (sin reservar stock: la tienda no reserva).
  select count(*) into v_pending from web_orders
   where phone = v_phone and status = 'pendiente_pago' and created_at > now() - interval '1 day';
  if v_pending >= 5 then
    raise exception 'Ya tiene varios pedidos pendientes de pago. Pague o cancele alguno antes de crear otro.'
      using errcode = 'IN003';
  end if;

  if v_ful = 'delivery' then
    select * into v_zone from store_delivery_zones
     where id = nullif(p_payload->>'zone_id', '')::uuid and active;
    if not found then
      raise exception 'Elija una zona de entrega' using errcode = 'IN003';
    end if;
    if v_address is null or length(v_address) not between 5 and 200 then
      raise exception 'Escriba la direccion de entrega (5 a 200 caracteres)' using errcode = 'IN003';
    end if;
    if v_reference is not null and length(v_reference) > 200 then
      raise exception 'La referencia es demasiado larga' using errcode = 'IN003';
    end if;
    v_fee := v_zone.fee;
  else
    select p.branch_id, p.label into v_pickup_branch, v_pickup_label
      from store_pickup_points p join branches b on b.id = p.branch_id
     where p.id = nullif(p_payload->>'pickup_id', '')::uuid and p.active and b.active;
    if not found then
      raise exception 'Elija donde recoger su pedido' using errcode = 'IN003';
    end if;
    v_address := null;
    v_reference := null;
  end if;

  -- Precios y disponibilidad salen de la base (el cliente nunca los decide).
  for v_line in
    select v.id as variant_id, v.sku, m.name as model_name, c.name as color_name, s.label as size_label,
           m.base_sale_price as price, x.qty, coalesce(sl.qty, 0) as have
      from (select y.variant_id, sum(y.qty)::int as qty
              from jsonb_to_recordset(v_items) as y(variant_id uuid, qty integer) group by y.variant_id) x
      left join variants v on v.id = x.variant_id and v.active
      left join models m on m.id = v.model_id and m.active and m.published_online and m.base_sale_price > 0
      left join colors c on c.id = v.color_id
      left join sizes s on s.id = v.size_id
      left join stock_levels sl on sl.variant_id = v.id and sl.branch_id = v_branch
     order by x.variant_id
  loop
    if v_line.model_name is null then
      raise exception 'Uno de los productos ya no esta disponible. Actualice su carrito.' using errcode = 'IN005';
    end if;
    if v_line.qty > 10 then
      raise exception 'Cada producto admite como maximo 10 unidades' using errcode = 'IN003';
    end if;
    if v_line.have < v_line.qty then
      raise exception 'No hay suficiente stock de % (% / talla %). Disponible: %.',
        v_line.model_name, v_line.color_name, v_line.size_label, least(v_line.have, 10)
        using errcode = 'IN001';
    end if;
    v_subtotal := v_subtotal + v_line.qty * v_line.price;
  end loop;

  select string_agg(substr(v_chars, 1 + floor(random() * 32)::int, 1), '') into v_code from generate_series(1, 6);
  v_code := 'NB-' || v_code;
  if exists (select 1 from web_orders o where o.code = v_code) then
    raise exception 'No se pudo generar el codigo del pedido. Intente nuevamente.' using errcode = 'IN005';
  end if;

  insert into web_orders (
    code, token_hash, idempotency_key, payment_method, fulfillment, branch_id, pickup_branch_id,
    customer_name, phone, email, wants_invoice, invoice_nit, invoice_name, invoice_status,
    delivery_zone_id, delivery_zone, delivery_address, delivery_reference, delivery_fee,
    subtotal, total, notes)
  values (
    v_code, p_token_hash, v_idem, v_pay, v_ful, v_branch, v_pickup_branch,
    v_name, v_phone, v_email, v_wants, case when v_wants then v_nit end, case when v_wants then v_inv_name end,
    case when v_wants then 'pending_manual' else 'none' end,
    v_zone.id, case when v_ful = 'delivery' then v_zone.name else v_pickup_label end,
    v_address, v_reference, v_fee, v_subtotal, v_subtotal + v_fee, v_notes)
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select * into v_existing from web_orders where idempotency_key = v_idem;
    return query select v_existing.code, v_existing.status, false;
    return;
  end if;

  insert into web_order_items (order_id, variant_id, sku, model_name, color_name, size_label, qty, unit_price)
  select v_order_id, v.id, v.sku, m.name, c.name, s.label, x.qty, m.base_sale_price
    from (select y.variant_id, sum(y.qty)::int as qty
            from jsonb_to_recordset(v_items) as y(variant_id uuid, qty integer) group by y.variant_id) x
    join variants v on v.id = x.variant_id
    join models m on m.id = v.model_id
    join colors c on c.id = v.color_id
    join sizes s on s.id = v.size_id;
  get diagnostics v_count = row_count;

  insert into web_order_events (order_id, actor_kind, to_status, note)
  values (v_order_id, 'buyer', 'pendiente_pago', 'Pedido creado');

  return query select v_code, 'pendiente_pago'::text, true;
end
$$;

create or replace function public_order_view(p_token_hash bytea) returns jsonb
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'code', o.code, 'status', o.status, 'payment_method', o.payment_method, 'fulfillment', o.fulfillment,
    'name', o.customer_name, 'phone', o.phone, 'email', o.email,
    'wants_invoice', o.wants_invoice, 'invoice_nit', o.invoice_nit, 'invoice_name', o.invoice_name,
    'zone', o.delivery_zone, 'address', o.delivery_address, 'reference', o.delivery_reference,
    'pickup', case when o.fulfillment = 'pickup' then
        (select jsonb_build_object('label', p.label, 'address', p.address, 'hours', p.hours)
           from store_pickup_points p where p.branch_id = o.pickup_branch_id) end,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'total', o.total, 'notes', o.notes,
    'payment_reference', o.payment_reference, 'proof_count', o.proof_count,
    'reject_reason', o.reject_reason, 'cancel_reason', o.cancel_reason,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('model', i.model_name, 'color', i.color_name, 'size', i.size_label,
                                          'qty', i.qty, 'unit_price', i.unit_price,
                                          'image', (select im.id from model_images im join variants v on v.id = i.variant_id
                                                     where im.model_id = v.model_id
                                                     order by (im.color_id = v.color_id) desc nulls last, (im.color_id is null) desc,
                                                              im.position, im.created_at limit 1))
                       order by i.model_name, i.color_name, i.size_label)
        from web_order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.at, 'status', e.to_status) order by e.at, e.id)
        from web_order_events e where e.order_id = o.id), '[]'::jsonb)
  )
  from web_orders o
  where p_token_hash is not null and octet_length(p_token_hash) = 32 and o.token_hash = p_token_hash
$$;

create or replace function public_order_attach_proof(p_token_hash bytea, p_bytes bytea, p_etag text, p_reference text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order     web_orders%rowtype;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'Pedido no encontrado' using errcode = 'IN005';
  end if;
  select * into v_order from web_orders where token_hash = p_token_hash for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'IN005';
  end if;
  if v_order.payment_method <> 'qr' or v_order.status not in ('pendiente_pago', 'pago_en_revision') then
    raise exception 'Este pedido ya no admite comprobantes' using errcode = 'IN005';
  end if;
  if p_bytes is null and v_reference is null then
    raise exception 'Suba la foto del comprobante o escriba el numero de transaccion' using errcode = 'IN003';
  end if;
  if v_reference is not null and length(v_reference) > 60 then
    raise exception 'El numero de transaccion es demasiado largo' using errcode = 'IN003';
  end if;
  if p_bytes is not null then
    if v_order.proof_count >= 3 then
      raise exception 'Ya envio el maximo de comprobantes para este pedido' using errcode = 'IN003';
    end if;
    insert into web_order_proofs (order_id, bytes, etag) values (v_order.id, p_bytes, p_etag);
  end if;
  update web_orders
     set proof_count = proof_count + case when p_bytes is not null then 1 else 0 end,
         payment_reference = coalesce(v_reference, payment_reference),
         status = 'pago_en_revision', reject_reason = null, updated_at = now()
   where id = v_order.id;
  if v_order.status <> 'pago_en_revision' then
    insert into web_order_events (order_id, actor_kind, from_status, to_status, note)
    values (v_order.id, 'buyer', v_order.status, 'pago_en_revision', 'Comprobante enviado');
  end if;
  return 'pago_en_revision';
end
$$;

create or replace function public_order_cancel(p_token_hash bytea) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order web_orders%rowtype;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'Pedido no encontrado' using errcode = 'IN005';
  end if;
  select * into v_order from web_orders where token_hash = p_token_hash for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'IN005';
  end if;
  if v_order.status = 'cancelado' then
    return 'cancelado';
  end if;
  if v_order.status <> 'pendiente_pago' then
    raise exception 'El pedido ya no se puede cancelar desde aqui. Escribanos por WhatsApp.' using errcode = 'IN005';
  end if;
  update web_orders
     set status = 'cancelado', cancel_reason = 'Cancelado por el cliente', cancelled_at = now(), updated_at = now()
   where id = v_order.id;
  insert into web_order_events (order_id, actor_kind, from_status, to_status, note)
  values (v_order.id, 'buyer', v_order.status, 'cancelado', 'Cancelado por el cliente');
  return 'cancelado';
end
$$;

-- QR de pago de la tienda: solo para quien tiene el enlace de un pedido por QR.
create or replace function public_payment_qr(p_token_hash bytea)
returns table (bytes bytea, content_type text, etag text)
language sql stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select a.bytes, a.content_type, a.etag
    from store_assets a
    join web_orders o on o.token_hash = p_token_hash and o.payment_method = 'qr'
   where a.key = 'payment_qr' and p_token_hash is not null and octet_length(p_token_hash) = 32
$$;

-- ---- dueño, cierre por defecto y permisos ----
alter function store_web_branch() owner to app_definer;
alter function store_setting(text) owner to app_definer;
alter function web_order_event(uuid, text, text, text, text) owner to app_definer;
alter function public_reserve_attempt(text, integer, integer) owner to app_definer;
alter function public_store_info() owner to app_definer;
alter function public_catalog_list() owner to app_definer;
alter function public_product(text) owner to app_definer;
alter function public_cart_lines(jsonb) owner to app_definer;
alter function public_image(uuid, text) owner to app_definer;
alter function public_create_order(jsonb, bytea) owner to app_definer;
alter function public_order_view(bytea) owner to app_definer;
alter function public_order_attach_proof(bytea, bytea, text, text) owner to app_definer;
alter function public_order_cancel(bytea) owner to app_definer;
alter function public_payment_qr(bytea) owner to app_definer;
alter function models_set_slug() owner to app_definer;
alter function model_images_limit() owner to app_definer;
alter function store_slugify(text) owner to app_definer;

revoke all on function store_web_branch(), store_setting(text), web_order_event(uuid, text, text, text, text),
  public_reserve_attempt(text, integer, integer), public_store_info(), public_catalog_list(), public_product(text),
  public_cart_lines(jsonb), public_image(uuid, text), public_create_order(jsonb, bytea), public_order_view(bytea),
  public_order_attach_proof(bytea, bytea, text, text), public_order_cancel(bytea), public_payment_qr(bytea),
  models_set_slug(), model_images_limit(), store_slugify(text)
  from public;

grant execute on function public_reserve_attempt(text, integer, integer), public_store_info(), public_catalog_list(),
  public_product(text), public_cart_lines(jsonb), public_image(uuid, text), public_create_order(jsonb, bytea),
  public_order_view(bytea), public_order_attach_proof(bytea, bytea, text, text), public_order_cancel(bytea),
  public_payment_qr(bytea)
  to app_runtime_public;

-- la app (superadmin/vendedor) lee el mismo origen de stock web y un par de ajustes
grant execute on function store_web_branch(), store_setting(text), store_slugify(text)
  to app_superadmin, app_seller;
grant execute on function models_set_slug(), model_images_limit() to app_superadmin;
