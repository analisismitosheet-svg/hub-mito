-- Franquicias → Dragon: las propuestas confirmadas se cargan como pedido de venta en
-- M1T0O1\ZOOLOGIC · DRAGONFISH_MITO (API REST, sólo altas). Lo hace la PC del puente
-- (puente-sql/scripts/sync-franquicias-dragon.js, tarea "MITO - Pedidos franquicias" cada 1 min),
-- autenticada con el PUENTE_TOKEN. Aplicado 2026-10-16.

alter table public.franquicias_propuestas
  add column if not exists dragon_enviando_at timestamptz,
  add column if not exists dragon_intentos integer not null default 0,
  add column if not exists dragon_at timestamptz;

-- Toma (y marca como "enviando") las confirmadas que todavía no están en Dragon.
-- Si el puente se corta a mitad de camino queda "enviando" y NO se reintenta solo
-- (podría estar cargado): se revisa en Dragon y se libera desde el hub con "Reintentar".
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
           'confirmada_at', t.confirmada_at, 'comentario', t.comentario,
           'items', (select coalesce(jsonb_agg(jsonb_build_object('art', i.art, 'color', i.color, 'talle', i.talle, 'cantidad', i.cantidad) order by i.orden), '[]'::jsonb)
                       from public.franquicias_propuesta_items i where i.propuesta_id = t.id and coalesce(i.cantidad, 0) > 0))), '[]'::jsonb)
    into r from tomadas t;
  return r;
end $$;

-- Resultado del alta: con número de pedido pasa a "en_dragon"; con error se libera para reintentar.
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
  else
    update public.franquicias_propuestas
       set dragon_error = left(coalesce(p_error, 'Error sin detalle'), 500), dragon_enviando_at = null
     where id = p_id;
  end if;
end $$;

revoke all on function public.franquicias_tomar_para_dragon(text) from public;
revoke all on function public.franquicias_resultado_dragon(text, uuid, text, text) from public;
grant execute on function public.franquicias_tomar_para_dragon(text) to anon, authenticated;
grant execute on function public.franquicias_resultado_dragon(text, uuid, text, text) to anon, authenticated;
