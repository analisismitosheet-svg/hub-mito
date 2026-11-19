-- Link de la propuesta (/p/:token): cada ítem trae también el stock del local (stock_cli),
-- para que el cliente vea «Stock local 10 · Venta 2 · Propuesta 1». Misma función que
-- sql/franquicias_reposicion_auto.sql con 'stock_cli' agregado; create or replace conserva los permisos.

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
        'sugerido', i.sugerido, 'vendido', i.vendido, 'stock_cli', i.stock_cli, 'maximo', i.stock_mito, 'precio', i.precio,
        'elegido', i.elegido, 'cantidad', i.cantidad) order by i.orden, i.id)
      from public.franquicias_propuesta_items i
      where i.propuesta_id = p.id and (i.sugerido > 0 or coalesce(i.cantidad, 0) > 0)), '[]'::jsonb)
  );
end $$;

