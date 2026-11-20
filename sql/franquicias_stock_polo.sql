-- Franquicias: la reposición (sugerida y automática) completa con el stock de Polo 52 lo que
-- MITO no cubre (19/11/2026). Polo sale de VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SKU_POLO.
--
-- En cada ítem:
--   stock_mito = disponible TOTAL (MITO + Polo): es el tope del + en el link y el recorte al confirmar,
--                así que el link y la confirmación no cambian.
--   stock_polo = la parte de ese disponible que está en Polo.
-- Al cargarse el pedido de venta en Dragon (franquicias_resultado_dragon), lo que pidió el cliente
-- por encima del stock de MITO sale de Polo: se crea un lote en Transferencias POLO52 → MITO,
-- como en el reparto de locales. Primero MITO, Polo completa.

alter table public.franquicias_propuesta_items
  add column if not exists stock_polo integer not null default 0;

-- Alta de la reposición automática: ahora guarda también stock_polo (p_items[].stock_polo).
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
    (propuesta_id, orden, art, descrip, material, color, talle, stock_cli, vendido, stock_mito, stock_polo, sugerido, precio)
  select v_id, (o - 1)::int, upper(btrim(e->>'art')), nullif(e->>'descrip', ''), nullif(e->>'material', ''),
         nullif(e->>'color', ''), nullif(e->>'talle', ''),
         coalesce((e->>'stock_cli')::int, 0), coalesce((e->>'vendido')::int, 0),
         coalesce((e->>'stock_mito')::int, 0), greatest(0, coalesce((e->>'stock_polo')::int, 0)),
         greatest(0, coalesce((e->>'sugerido')::int, 0)),
         nullif((e->>'precio')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as t(e, o)
   where nullif(btrim(e->>'art'), '') is not null;

  insert into public.franquicias_propuesta_envios (propuesta_id, telefono)
  select v_id, t from unnest(c.telefonos) t
  on conflict do nothing;
  get diagnostics n_envios = row_count;

  return jsonb_build_object('ok', true, 'numero', v_num, 'id', v_id, 'unidades', uni, 'total', tot, 'envios', n_envios);
end $$;

-- Lote de Transferencias con lo que sale de Polo para una propuesta ya cargada en Dragon.
-- Por ítem: de Polo = mín(stock_polo, máx(0, cantidad − stock de MITO)), con stock de MITO = stock_mito − stock_polo.
-- El nombre lleva el número de propuesta: cascada_crear_lote no repite un lote con el mismo nombre en 7 días.
create or replace function private.franquicias_lote_polo(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p record;
  v_items jsonb;
begin
  select * into p from public.franquicias_propuestas where id = p_id;
  if not found then return null; end if;

  select jsonb_agg(jsonb_build_object(
           'origen', 'POLO52', 'destino', 'MITO', 'articulo', x.art, 'descripcion', x.descrip,
           'material', x.material, 'color', x.color, 'talle', x.talle, 'cantidad', x.polo, 'tipo', 'VENTA')
         order by x.orden)
    into v_items
    from (select i.orden, i.art, i.descrip, i.material, i.color, i.talle,
                 least(i.stock_polo, greatest(0, coalesce(i.cantidad, 0) - greatest(0, i.stock_mito - i.stock_polo))) as polo
            from public.franquicias_propuesta_items i
           where i.propuesta_id = p_id and i.stock_polo > 0 and coalesce(i.cantidad, 0) > 0) x
   where x.polo > 0;

  if v_items is null then return null; end if;

  return private.cascada_crear_lote(
    to_char(now() at time zone 'America/Argentina/Cordoba', 'YYMMDD') || ' - FRANQUICIA ' || p.franquicia || ' N° ' || p.numero || ' - POLO',
    'Reposición franquicia ' || coalesce(p.cliente_nombre, p.franquicia_nombre, p.franquicia)
      || coalesce(' · pedido Dragon ' || p.dragon_pedido, '') || ' · Polo → MITO',
    v_items, null);
end $$;
revoke all on function private.franquicias_lote_polo(uuid) from public, anon, authenticated;

-- Resultado del alta en Dragon: con número de pedido pasa a "en_dragon" y, si algo sale de Polo,
-- crea su transferencia. Si el lote falla, el pedido igual queda en Dragon (se avisa en dragon_error).
create or replace function public.franquicias_resultado_dragon(p_token text, p_id uuid, p_pedido text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_pedido, '')), '') is not null then
    update public.franquicias_propuestas
       set estado = 'en_dragon', dragon_pedido = p_pedido, dragon_error = null, dragon_at = now(), dragon_enviando_at = null
     where id = p_id;
    begin
      perform private.franquicias_lote_polo(p_id);
    exception when others then
      update public.franquicias_propuestas
         set dragon_error = left('Pedido cargado, pero no se pudo crear la transferencia de Polo: ' || sqlerrm, 500)
       where id = p_id;
    end;
  else
    update public.franquicias_propuestas
       set dragon_error = left(coalesce(p_error, 'Error sin detalle'), 500), dragon_enviando_at = null
     where id = p_id;
  end if;
end $$;

revoke all on function public.franquicias_resultado_dragon(text, uuid, text, text) from public;
grant execute on function public.franquicias_resultado_dragon(text, uuid, text, text) to anon, authenticated;
