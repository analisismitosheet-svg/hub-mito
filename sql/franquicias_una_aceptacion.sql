-- ============================================================================
-- Reposición diaria de franquicias: una sola aceptación por cliente y fechas (25/11/2026).
--
-- Antes el bloqueo era por propuesta: el primero que confirmaba cerraba ESA
-- propuesta. Pero «Armar ahora» vuelve a armar las mismas fechas de venta y las
-- propuestas anteriores seguían abiertas (cliente 01140: P-003…P-007 pendientes
-- para la venta del 19/11 que ya había entrado con P-008 y PRUEBA-01). Aceptar
-- una vieja duplicaba el pedido.
--
-- Ahora, para reposiciones (tipo 'reposicion') del mismo cliente con fechas de
-- venta que se pisan:
--   - Al ARMAR una nueva: si ya hay una aceptada (sin anular en Dragon) no se arma
--     (devuelve repetida); las pendientes quedan anuladas con reemplazada_por = la nueva.
--   - Al CONFIRMAR: se bloquea el cliente (franquicias_clientes FOR UPDATE, el mismo
--     lock que el armado) para que dos links distintos no confirmen a la vez; si otra
--     ya fue aceptada se rechaza; las demás pendientes quedan reemplazadas por esta.
--   - Dentro de una misma propuesta sigue igual: FOR UPDATE + estado 'enviada'
--     (si le llegó a varios números, confirma uno solo).
--   - El link de una reemplazada muestra «🔒 reemplazada por la N° X» (no «no existe»).
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.franquicias_propuestas
  ADD COLUMN IF NOT EXISTS reemplazada_por uuid REFERENCES public.franquicias_propuestas(id);

-- Reposición aceptada del cliente que pisa esas fechas (la más nueva), o null
CREATE OR REPLACE FUNCTION private.franquicias_aceptada_solapada(p_cliente text, p_desde date, p_hasta date, p_excepto uuid)
RETURNS public.franquicias_propuestas
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.* FROM public.franquicias_propuestas p
   WHERE p.cliente_id = p_cliente
     AND p.tipo = 'reposicion'
     AND p.id IS DISTINCT FROM p_excepto
     AND p.estado IN ('confirmada', 'en_dragon')
     AND p.dragon_anulado_at IS NULL
     AND daterange(p.desde, p.hasta, '[]') && daterange(p_desde, p_hasta, '[]')
   ORDER BY p.confirmada_at DESC NULLS LAST
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.franquicias_aceptada_solapada(text, date, date, uuid) FROM anon, public;

-- Pasa a «reemplazada» las pendientes del cliente que pisan esas fechas
CREATE OR REPLACE FUNCTION private.franquicias_reemplazar_pendientes(p_cliente text, p_desde date, p_hasta date, p_nueva uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.franquicias_propuestas p
     SET estado = 'anulada', reemplazada_por = p_nueva
   WHERE p.cliente_id = p_cliente
     AND p.tipo = 'reposicion'
     AND p.id <> p_nueva
     AND p.estado = 'enviada'
     AND daterange(p.desde, p.hasta, '[]') && daterange(p_desde, p_hasta, '[]');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION private.franquicias_reemplazar_pendientes(text, date, date, uuid) FROM anon, public;

-- ---- Armado: no repetir lo aceptado y reemplazar lo pendiente ----
CREATE OR REPLACE FUNCTION private.franquicias_crear_reposicion(p_cliente text, p_desde date, p_hasta date, p_items jsonb, p_origen text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  c record;
  v_id uuid;
  v_num text;
  uni integer;
  tot numeric;
  n_envios integer;
  v_ya public.franquicias_propuestas;
  n_reemp integer;
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

  -- Esas ventas ya tienen una reposición aceptada: no se arma otra (sería pedido duplicado)
  v_ya := private.franquicias_aceptada_solapada(p_cliente, p_desde, p_hasta, null);
  if v_ya.id is not null then
    return jsonb_build_object('ok', true, 'numero', null, 'unidades', 0, 'repetida', true, 'ya_aceptada', v_ya.numero);
  end if;

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

  -- Las que seguían pendientes para esas fechas quedan reemplazadas por esta
  n_reemp := private.franquicias_reemplazar_pendientes(p_cliente, p_desde, p_hasta, v_id);

  insert into public.franquicias_propuesta_envios (propuesta_id, telefono)
  select v_id, t from unnest(c.telefonos) t
  on conflict do nothing;
  get diagnostics n_envios = row_count;

  return jsonb_build_object('ok', true, 'numero', v_num, 'id', v_id, 'unidades', uni, 'total', tot,
                            'envios', n_envios, 'reemplazadas', n_reemp);
end $$;

-- ---- Confirmar: una sola aceptación por cliente y fechas ----
CREATE OR REPLACE FUNCTION public.confirmar_propuesta_franquicia(p_token text, p_items jsonb, p_comentario text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  t record;
  p public.franquicias_propuestas;
  v_ya public.franquicias_propuestas;
  v_cli text;
  r record;
  uni integer := 0;
  tot numeric := 0;
begin
  select * into t from private.propuesta_por_token(p_token);
  if t.p_id is null then
    raise exception 'La propuesta no existe' using errcode = 'P0002';
  end if;

  -- Primero el cliente (mismo orden de locks que el armado): dos links distintos
  -- del mismo cliente no pueden confirmar a la vez
  select cliente_id into v_cli from public.franquicias_propuestas where id = t.p_id;
  if v_cli is not null then
    perform 1 from public.franquicias_clientes where cliente_id = v_cli for update;
  end if;

  select * into p from public.franquicias_propuestas where id = t.p_id for update;
  if not found or p.estado = 'borrador' then
    raise exception 'La propuesta no existe' using errcode = 'P0002';
  end if;
  if p.estado = 'anulada' then
    if p.reemplazada_por is not null then
      raise exception 'Esta propuesta fue reemplazada por la N° %: abrí el último link que te mandamos',
        (select x.numero from public.franquicias_propuestas x where x.id = p.reemplazada_por) using errcode = 'P0001';
    end if;
    raise exception 'La propuesta no existe' using errcode = 'P0002';
  end if;
  if p.estado <> 'enviada' then
    raise exception 'Este pedido ya fue aceptado%',
      case when p.confirmada_por is not null then ' por +' || p.confirmada_por else '' end using errcode = 'P0001';
  end if;
  if p.vence_at < now() then
    raise exception 'La propuesta venció: pedile a MITO una nueva' using errcode = 'P0001';
  end if;

  -- Otra reposición de esas mismas ventas ya fue aceptada: esta queda reemplazada
  if p.tipo = 'reposicion' and p.cliente_id is not null then
    v_ya := private.franquicias_aceptada_solapada(p.cliente_id, p.desde, p.hasta, p.id);
    if v_ya.id is not null then
      -- Se guarda (sin excepción, que desharía el cambio) y el link pasa a mostrar el bloqueo
      update public.franquicias_propuestas set estado = 'anulada', reemplazada_por = v_ya.id where id = p.id;
      return jsonb_build_object('ok', false, 'reemplazada', true,
        'error', 'Este pedido ya fue aceptado con la N° ' || v_ya.numero
                 || case when v_ya.confirmada_por is not null then ' por +' || v_ya.confirmada_por else '' end);
    end if;
  end if;

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

  -- Las demás pendientes de esas fechas ya no se pueden aceptar
  if p.tipo = 'reposicion' and p.cliente_id is not null then
    perform private.franquicias_reemplazar_pendientes(p.cliente_id, p.desde, p.hasta, p.id);
  end if;

  return jsonb_build_object('ok', true, 'numero', p.numero, 'unidades', uni, 'total', tot);
end $$;

-- ---- Link público: la reemplazada se ve con su cartel (antes daba «no existe») ----
CREATE OR REPLACE FUNCTION public.propuesta_franquicia_publica(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  t record;
  p public.franquicias_propuestas;
  q public.franquicias_propuestas;
begin
  select * into t from private.propuesta_por_token(p_token);
  if t.p_id is null then return null; end if;
  select * into p from public.franquicias_propuestas
   where id = t.p_id and estado <> 'borrador' and (estado <> 'anulada' or reemplazada_por is not null);
  if not found then return null; end if;
  if p.reemplazada_por is not null then
    select * into q from public.franquicias_propuestas where id = p.reemplazada_por;
  end if;
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
    'dragon_pedido', p.dragon_pedido, 'dragon_anulado_at', p.dragon_anulado_at,
    'comentario', p.comentario,
    -- Reemplazada por otra reposición de las mismas ventas (sql/franquicias_una_aceptacion.sql)
    'reemplazada', p.reemplazada_por is not null,
    'reemplazada_por_numero', q.numero,
    'reemplazo_aceptado', q.estado in ('confirmada', 'en_dragon'),
    'reemplazo_aceptado_at', q.confirmada_at,
    'reemplazo_aceptado_por', q.confirmada_por,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'art', i.art, 'descrip', i.descrip, 'color', i.color, 'talle', i.talle,
        'sugerido', i.sugerido, 'vendido', i.vendido, 'stock_cli', i.stock_cli, 'maximo', i.stock_mito, 'precio', i.precio,
        'elegido', i.elegido, 'cantidad', i.cantidad) order by i.orden, i.id)
      from public.franquicias_propuesta_items i
      where i.propuesta_id = p.id and (i.sugerido > 0 or coalesce(i.cantidad, 0) > 0)), '[]'::jsonb)
  );
end $$;

-- ---- Limpieza de lo que ya estaba abierto ----
-- 1) Pendientes que pisan fechas ya aceptadas: reemplazadas por la aceptada más nueva
UPDATE public.franquicias_propuestas p
   SET estado = 'anulada',
       reemplazada_por = (private.franquicias_aceptada_solapada(p.cliente_id, p.desde, p.hasta, p.id)).id
 WHERE p.tipo = 'reposicion' AND p.estado = 'enviada' AND p.cliente_id IS NOT NULL
   AND (private.franquicias_aceptada_solapada(p.cliente_id, p.desde, p.hasta, p.id)).id IS NOT NULL;

-- 2) Pendientes que se pisan entre sí: queda abierta la más nueva
UPDATE public.franquicias_propuestas p
   SET estado = 'anulada',
       reemplazada_por = (SELECT n.id FROM public.franquicias_propuestas n
                           WHERE n.cliente_id = p.cliente_id AND n.tipo = 'reposicion' AND n.estado = 'enviada'
                             AND n.creado_at > p.creado_at
                             AND daterange(n.desde, n.hasta, '[]') && daterange(p.desde, p.hasta, '[]')
                           ORDER BY n.creado_at DESC LIMIT 1)
 WHERE p.tipo = 'reposicion' AND p.estado = 'enviada' AND p.cliente_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.franquicias_propuestas n
                WHERE n.cliente_id = p.cliente_id AND n.tipo = 'reposicion' AND n.estado = 'enviada'
                  AND n.creado_at > p.creado_at
                  AND daterange(n.desde, n.hasta, '[]') && daterange(p.desde, p.hasta, '[]'));

COMMIT;
