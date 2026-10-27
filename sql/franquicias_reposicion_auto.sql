-- ============================================================================
-- Franquicias · Reposición diaria automática (27/10/2026)
--
--   1. Por cliente: base, varios WhatsApps, días y hora de salida (franquicias_clientes).
--   2. El puente (puente-sql/scripts/reposicion-franquicias-auto.js, cada 1 min) pide los
--      clientes que tocan (franquicias_auto_pendientes), arma la reposición con la venta
--      de ayer en su SQL y la guarda (franquicias_auto_crear): propuesta + un envío por número.
--   3. /api/informe?evento=franquicias manda la plantilla de WhatsApp a cada número con SU link
--      (cada envío tiene token propio: así se sabe quién confirmó).
--   4. El primero que confirma impacta en Dragon (sync-franquicias-dragon.js, igual que antes);
--      a los demás el link les muestra "ya fue aceptado por +54…" y queda bloqueado.
--
-- Aplicado en Supabase (migración franquicias_reposicion_auto). Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Configuración por cliente
-- ---------------------------------------------------------------------------
alter table public.franquicias_clientes
  add column if not exists telefonos text[] not null default '{}',
  add column if not exists auto_activo boolean not null default false,
  -- 1 = lunes … 7 = domingo (isodow)
  add column if not exists auto_dias integer[] not null default '{1,2,3,4,5,6}',
  add column if not exists auto_hora text not null default '09:00',
  -- última venta (día) que ya se armó: evita repetir y marca desde dónde sigue
  add column if not exists auto_ultimo_hasta date,
  -- "Armar ahora" desde el hub: el puente lo toma en el próximo minuto aunque no sea el día/hora
  add column if not exists auto_pedido_at timestamptz,
  add column if not exists auto_error text;

-- El teléfono de antes pasa a ser el primero de la lista
update public.franquicias_clientes
   set telefonos = array[telefono]
 where telefono is not null and btrim(telefono) <> '' and cardinality(telefonos) = 0;

-- ---------------------------------------------------------------------------
-- Propuestas: de dónde salió y quién la confirmó
-- ---------------------------------------------------------------------------
alter table public.franquicias_propuestas
  add column if not exists origen text not null default 'manual',
  add column if not exists confirmada_por text;

-- Un envío por número: cada uno con su link (token) y su estado de WhatsApp
create table if not exists public.franquicias_propuesta_envios (
  id bigserial primary key,
  propuesta_id uuid not null references public.franquicias_propuestas(id) on delete cascade,
  telefono text not null,
  token text unique not null default encode(extensions.gen_random_bytes(18), 'hex'),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'error')),
  intentos integer not null default 0,
  detalle text,
  enviado_at timestamptz,
  abierto_at timestamptz,
  creado_at timestamptz not null default now(),
  unique (propuesta_id, telefono)
);
create index if not exists franquicias_propuesta_envios_pend
  on public.franquicias_propuesta_envios (creado_at) where estado <> 'enviado';

alter table public.franquicias_propuesta_envios enable row level security;
drop policy if exists franquicias_propuesta_envios_hub on public.franquicias_propuesta_envios;
create policy franquicias_propuesta_envios_hub on public.franquicias_propuesta_envios
  for all to authenticated
  using (private.tengo_permiso('mayorista.franquicias.view'))
  with check (private.tengo_permiso('mayorista.franquicias.view'));

-- ---------------------------------------------------------------------------
-- Guardar la configuración desde la pantalla
-- ---------------------------------------------------------------------------
create or replace function public.franquicias_guardar_auto(
  p_cliente text, p_base text, p_sucursal text, p_telefonos text[],
  p_activo boolean, p_dias integer[], p_hora text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tels text[];
  v_dias integer[];
begin
  if not private.tengo_permiso('mayorista.franquicias.view') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_base, '')), '') is null then
    raise exception 'Elegí la base de la franquicia';
  end if;
  if not exists (select 1 from public.franquicias_bases where base = btrim(p_base)) then
    raise exception 'La base % no existe', p_base;
  end if;
  if coalesce(p_hora, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
    raise exception 'Hora inválida (HH:MM)';
  end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v_tels
    from (select regexp_replace(x, '\D', '', 'g') t from unnest(coalesce(p_telefonos, '{}')) x) s
   where length(t) >= 8;
  select coalesce(array_agg(distinct d order by d), '{}') into v_dias
    from unnest(coalesce(p_dias, '{}')) d where d between 1 and 7;
  if p_activo and cardinality(v_tels) = 0 then
    raise exception 'Cargá al menos un WhatsApp para activar el envío automático';
  end if;
  if p_activo and cardinality(v_dias) = 0 then
    raise exception 'Elegí al menos un día de salida';
  end if;

  insert into public.franquicias_clientes (cliente_id, base, telefono, telefonos, auto_activo, auto_dias, auto_hora, creado_por)
  values (p_cliente, btrim(p_base), v_tels[1], v_tels, coalesce(p_activo, false), v_dias, p_hora, auth.uid())
  on conflict (cliente_id) do update
    set base = excluded.base, telefono = excluded.telefono, telefonos = excluded.telefonos,
        auto_activo = excluded.auto_activo, auto_dias = excluded.auto_dias, auto_hora = excluded.auto_hora,
        auto_error = null;

  -- La sucursal de stock es de la base (todos sus clientes la comparten)
  if nullif(btrim(coalesce(p_sucursal, '')), '') is not null then
    update public.franquicias_bases set sucursal = upper(btrim(p_sucursal)) where base = btrim(p_base);
  end if;
end $$;

-- "Armar ahora": el puente arma la de ayer en el próximo minuto
create or replace function public.franquicias_pedir_armado(p_cliente text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.tengo_permiso('mayorista.franquicias.view') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update public.franquicias_clientes set auto_pedido_at = now(), auto_error = null where cliente_id = p_cliente;
  if not found then raise exception 'Guardá primero los datos del cliente'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Puente: qué clientes tocan ahora
--   - automático activo, hoy es uno de sus días y ya pasó la hora (Argentina), y
--     la venta de ayer todavía no se armó; o
--   - alguien tocó "Armar ahora" (auto_pedido_at).
--   desde = el día siguiente al último armado (como mucho 7 días atrás), hasta = ayer.
-- ---------------------------------------------------------------------------
create or replace function public.franquicias_auto_pendientes(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ahora timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  ayer date := (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1;
  r jsonb;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'cliente_id', c.cliente_id,
           'cliente_nombre', coalesce(cl.razon_social, c.cliente_id),
           'base', c.base,
           'sucursal', b.sucursal,
           'franquicia_nombre', coalesce(b.nombre, c.base),
           -- con "Armar ahora" sobre un día ya armado, se vuelve a armar ayer
           'desde', least(greatest(coalesce(c.auto_ultimo_hasta + 1, ayer), ayer - 6), ayer),
           'hasta', ayer,
           'forzado', c.auto_pedido_at is not null)), '[]'::jsonb)
    into r
    from public.franquicias_clientes c
    join public.franquicias_bases b on b.base = c.base
    left join lateral (
      select razon_social from public.clientes x
       where lpad(btrim(x.n_cliente), 5, '0') = c.cliente_id
       order by (x.estado = 'ACTIVO') desc limit 1) cl on true
   where cardinality(c.telefonos) > 0
     and (c.auto_pedido_at is not null
          or (c.auto_activo
              and extract(isodow from ahora)::int = any (c.auto_dias)
              and to_char(ahora, 'HH24:MI') >= c.auto_hora
              and coalesce(c.auto_ultimo_hasta, date '1900-01-01') < ayer));
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Alta de la reposición (la usa el puente). p_items: [{art, descrip, material, color,
-- talle, vendido, stock_cli, stock_mito, sugerido, precio}]. Guarda TODO lo vendido
-- (para la tabla del hub); al link solo van los de sugerido > 0.
-- Sin nada para reponer no crea propuesta, pero igual marca el día como armado.
-- ---------------------------------------------------------------------------
create or replace function private.franquicias_crear_reposicion(
  p_cliente text, p_desde date, p_hasta date, p_items jsonb, p_origen text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_id uuid;
  v_num text;
  uni integer;
  tot numeric;
  n_envios integer;
begin
  select fc.*, b.nombre as base_nombre,
         coalesce((select razon_social from public.clientes x where lpad(btrim(x.n_cliente), 5, '0') = fc.cliente_id
                    order by (x.estado = 'ACTIVO') desc limit 1), fc.cliente_id) as razon
    into c
    from public.franquicias_clientes fc join public.franquicias_bases b on b.base = fc.base
   where fc.cliente_id = p_cliente
   for update of fc;
  if not found then raise exception 'El cliente % no tiene base configurada', p_cliente; end if;

  select coalesce(sum(greatest(0, (e->>'sugerido')::int)), 0),
         coalesce(sum(greatest(0, (e->>'sugerido')::int) * coalesce((e->>'precio')::numeric, 0)), 0)
    into uni, tot
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e;

  update public.franquicias_clientes
     set auto_ultimo_hasta = greatest(coalesce(auto_ultimo_hasta, p_hasta), p_hasta),
         auto_pedido_at = null, auto_error = null
   where cliente_id = p_cliente;

  if uni = 0 then
    return jsonb_build_object('ok', true, 'numero', null, 'unidades', 0);
  end if;

  insert into public.franquicias_propuestas
    (franquicia, franquicia_nombre, cliente_id, cliente_nombre, tipo, origen, desde, hasta,
     estado, unidades_propuestas, total_propuesto)
  values
    (upper(regexp_replace(c.base, '^DRAGONFISH_', '', 'i')), coalesce(c.base_nombre, c.base), c.cliente_id, c.razon,
     'reposicion', p_origen, p_desde, p_hasta, 'enviada', uni, tot)
  returning id, numero into v_id, v_num;

  insert into public.franquicias_propuesta_items
    (propuesta_id, orden, art, descrip, material, color, talle, stock_cli, vendido, stock_mito, sugerido, precio)
  select v_id, (o - 1)::int, upper(btrim(e->>'art')), nullif(e->>'descrip', ''), nullif(e->>'material', ''),
         nullif(e->>'color', ''), nullif(e->>'talle', ''),
         coalesce((e->>'stock_cli')::int, 0), coalesce((e->>'vendido')::int, 0),
         coalesce((e->>'stock_mito')::int, 0), greatest(0, coalesce((e->>'sugerido')::int, 0)),
         nullif((e->>'precio')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as t(e, o)
   where nullif(btrim(e->>'art'), '') is not null;

  insert into public.franquicias_propuesta_envios (propuesta_id, telefono)
  select v_id, t from unnest(c.telefonos) t
  on conflict do nothing;
  get diagnostics n_envios = row_count;

  return jsonb_build_object('ok', true, 'numero', v_num, 'id', v_id, 'unidades', uni, 'total', tot, 'envios', n_envios);
end $$;

create or replace function public.franquicias_auto_crear(
  p_token text, p_cliente text, p_desde date, p_hasta date, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ult date;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  -- Ya armada (otra corrida ganó) y nadie pidió "Armar ahora": no duplica
  select auto_ultimo_hasta into v_ult from public.franquicias_clientes
   where cliente_id = p_cliente and auto_pedido_at is null for update;
  if found and v_ult is not null and v_ult >= p_hasta then
    return jsonb_build_object('ok', true, 'numero', null, 'repetida', true);
  end if;
  return private.franquicias_crear_reposicion(p_cliente, p_desde, p_hasta, p_items,
           case when exists (select 1 from public.franquicias_clientes where cliente_id = p_cliente and auto_pedido_at is not null)
                then 'manual' else 'auto' end);
end $$;

-- Si el puente no puede armarla (SQL caído, etc.) deja el error a la vista en el hub
create or replace function public.franquicias_auto_error(p_token text, p_cliente text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update public.franquicias_clientes set auto_error = left(p_error, 500), auto_pedido_at = null where cliente_id = p_cliente;
end $$;

-- ---------------------------------------------------------------------------
-- Link público: acepta el token de la propuesta (link general) o el de un envío
-- (link de un número). Devuelve quién confirmó para el cartel de bloqueo.
-- ---------------------------------------------------------------------------
create or replace function private.propuesta_por_token(p_token text, out p_id uuid, out p_tel text, out p_envio bigint)
language plpgsql security definer set search_path = public as $$
begin
  select e.propuesta_id, e.telefono, e.id into p_id, p_tel, p_envio
    from public.franquicias_propuesta_envios e where e.token = p_token;
  if p_id is null then
    select id into p_id from public.franquicias_propuestas where token = p_token;
  end if;
end $$;

create or replace function public.propuesta_franquicia_publica(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record;
  p public.franquicias_propuestas;
begin
  select * into t from private.propuesta_por_token(p_token);
  if t.p_id is null then return null; end if;
  select * into p from public.franquicias_propuestas where id = t.p_id and estado <> 'borrador' and estado <> 'anulada';
  if not found then return null; end if;
  if p.abierta_at is null then
    update public.franquicias_propuestas set abierta_at = now() where id = p.id;
  end if;
  if t.p_envio is not null then
    update public.franquicias_propuesta_envios set abierto_at = coalesce(abierto_at, now()) where id = t.p_envio;
  end if;
  return jsonb_build_object(
    'numero', p.numero,
    'franquicia', p.franquicia_nombre,
    'cliente', p.cliente_nombre,
    'tipo', p.tipo,
    'origen', p.origen,
    'desde', p.desde,
    'hasta', p.hasta,
    'vence_at', p.vence_at,
    'vencida', p.estado = 'enviada' and p.vence_at < now(),
    'confirmada', p.estado in ('confirmada', 'en_dragon'),
    'confirmada_at', p.confirmada_at,
    'confirmada_por', p.confirmada_por,
    -- true si lo confirmó este mismo número (o el link general sin número)
    'confirmada_por_mi', p.estado in ('confirmada', 'en_dragon')
                          and coalesce(p.confirmada_por, '') = coalesce(t.p_tel, ''),
    'contacto', t.p_tel,
    'dragon_pedido', p.dragon_pedido,
    'comentario', p.comentario,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'art', i.art, 'descrip', i.descrip, 'color', i.color, 'talle', i.talle,
        'sugerido', i.sugerido, 'vendido', i.vendido, 'maximo', i.stock_mito, 'precio', i.precio,
        'elegido', i.elegido, 'cantidad', i.cantidad) order by i.orden, i.id)
      from public.franquicias_propuesta_items i
      where i.propuesta_id = p.id and (i.sugerido > 0 or coalesce(i.cantidad, 0) > 0)), '[]'::jsonb)
  );
end $$;

create or replace function public.confirmar_propuesta_franquicia(p_token text, p_items jsonb, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record;
  p public.franquicias_propuestas;
  r record;
  uni integer := 0;
  tot numeric := 0;
begin
  select * into t from private.propuesta_por_token(p_token);
  select * into p from public.franquicias_propuestas where id = t.p_id for update;
  if not found or p.estado in ('borrador', 'anulada') then
    raise exception 'La propuesta no existe' using errcode = 'P0002';
  end if;
  if p.estado <> 'enviada' then
    raise exception 'Este pedido ya fue aceptado%',
      case when p.confirmada_por is not null then ' por +' || p.confirmada_por else '' end using errcode = 'P0001';
  end if;
  if p.vence_at < now() then
    raise exception 'La propuesta venció: pedile a MITO una nueva' using errcode = 'P0001';
  end if;

  -- Lo que no viene en p_items queda como "no"
  update public.franquicias_propuesta_items set elegido = false, cantidad = 0 where propuesta_id = p.id;
  for r in select (e->>'id')::bigint as id, greatest(0, coalesce((e->>'cantidad')::integer, 0)) as cant
             from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e loop
    update public.franquicias_propuesta_items
       set cantidad = least(r.cant, stock_mito), elegido = least(r.cant, stock_mito) > 0
     where id = r.id and propuesta_id = p.id;
  end loop;

  select coalesce(sum(cantidad), 0), coalesce(sum(cantidad * coalesce(precio, 0)), 0) into uni, tot
    from public.franquicias_propuesta_items where propuesta_id = p.id;

  update public.franquicias_propuestas
     set estado = 'confirmada', confirmada_at = now(), unidades_confirmadas = uni, total_confirmado = tot,
         confirmada_por = t.p_tel,
         comentario = nullif(btrim(coalesce(p_comentario, '')), '')
   where id = p.id;

  return jsonb_build_object('ok', true, 'numero', p.numero, 'unidades', uni, 'total', tot);
end $$;

revoke all on function public.franquicias_guardar_auto(text, text, text, text[], boolean, integer[], text) from public, anon;
revoke all on function public.franquicias_pedir_armado(text) from public, anon;
grant execute on function public.franquicias_guardar_auto(text, text, text, text[], boolean, integer[], text) to authenticated;
grant execute on function public.franquicias_pedir_armado(text) to authenticated;

-- El puente llama como anon con su clave (clave_sync_ok)
revoke all on function public.franquicias_auto_pendientes(text) from public;
revoke all on function public.franquicias_auto_crear(text, text, date, date, jsonb) from public;
revoke all on function public.franquicias_auto_error(text, text, text) from public;
grant execute on function public.franquicias_auto_pendientes(text) to anon, authenticated;
grant execute on function public.franquicias_auto_crear(text, text, date, date, jsonb) to anon, authenticated;
grant execute on function public.franquicias_auto_error(text, text, text) to anon, authenticated;

revoke all on function private.franquicias_crear_reposicion(text, date, date, jsonb, text) from public;
revoke all on function private.propuesta_por_token(text) from public;

revoke all on function public.propuesta_franquicia_publica(text) from public;
revoke all on function public.confirmar_propuesta_franquicia(text, jsonb, text) from public;
grant execute on function public.propuesta_franquicia_publica(text) to anon, authenticated;
grant execute on function public.confirmar_propuesta_franquicia(text, jsonb, text) to anon, authenticated;
