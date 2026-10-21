-- ============================================================
-- Franquicias multi-cliente: la propuesta guarda el cliente destino
-- (el que después se carga en Dragon) y el tipo (reposición / calzado).
-- Aplicado: (pendiente)
-- ============================================================

alter table public.franquicias_propuestas
  add column if not exists cliente_id text,
  add column if not exists cliente_nombre text,
  add column if not exists tipo text not null default 'reposicion';

-- ---------------------------------------------------------------------------
-- Link público del cliente: agrega el cliente destino y el tipo
-- ---------------------------------------------------------------------------
create or replace function public.propuesta_franquicia_publica(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.franquicias_propuestas;
begin
  select * into p from public.franquicias_propuestas where token = p_token and estado <> 'borrador' and estado <> 'anulada';
  if not found then return null; end if;
  if p.abierta_at is null then
    update public.franquicias_propuestas set abierta_at = now() where id = p.id;
  end if;
  return jsonb_build_object(
    'numero', p.numero,
    'franquicia', p.franquicia_nombre,
    'cliente', p.cliente_nombre,
    'tipo', p.tipo,
    'desde', p.desde,
    'hasta', p.hasta,
    'vence_at', p.vence_at,
    'vencida', p.estado = 'enviada' and p.vence_at < now(),
    'confirmada', p.estado in ('confirmada', 'en_dragon'),
    'confirmada_at', p.confirmada_at,
    'comentario', p.comentario,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'art', i.art, 'descrip', i.descrip, 'color', i.color, 'talle', i.talle,
        'sugerido', i.sugerido, 'vendido', i.vendido, 'maximo', i.stock_mito, 'precio', i.precio,
        'elegido', i.elegido, 'cantidad', i.cantidad) order by i.orden, i.id)
      from public.franquicias_propuesta_items i where i.propuesta_id = p.id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Puente → Dragon: manda el cliente destino de la propuesta
-- ---------------------------------------------------------------------------
create or replace function public.franquicias_tomar_para_dragon(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  with tomadas as (
    update public.franquicias_propuestas p
       set dragon_enviando_at = now(), dragon_intentos = p.dragon_intentos + 1
     where p.id in (
       select id from public.franquicias_propuestas
        where estado = 'confirmada' and dragon_pedido is null and dragon_enviando_at is null
          and dragon_intentos < 5 and coalesce(unidades_confirmadas, 0) > 0
        order by confirmada_at limit 5 for update skip locked)
    returning p.*)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'numero', t.numero, 'franquicia', t.franquicia, 'franquicia_nombre', t.franquicia_nombre,
           'cliente_id', t.cliente_id, 'cliente_nombre', t.cliente_nombre, 'tipo', t.tipo,
           'confirmada_at', t.confirmada_at, 'comentario', t.comentario,
           'items', (select coalesce(jsonb_agg(jsonb_build_object('art', i.art, 'color', i.color, 'talle', i.talle, 'cantidad', i.cantidad) order by i.orden), '[]'::jsonb)
                       from public.franquicias_propuesta_items i where i.propuesta_id = t.id and coalesce(i.cantidad, 0) > 0))), '[]'::jsonb)
    into r from tomadas t;
  return r;
end $$;

revoke all on function public.propuesta_franquicia_publica(text) from public;
revoke all on function public.franquicias_tomar_para_dragon(text) from public;
grant execute on function public.propuesta_franquicia_publica(text) to anon, authenticated;
grant execute on function public.franquicias_tomar_para_dragon(text) to anon, authenticated;
