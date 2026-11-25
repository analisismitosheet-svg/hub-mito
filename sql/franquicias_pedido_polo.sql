-- Franquicias: lo que sale de Polo 52 va en un pedido de venta aparte en Dragon (25/11/2026).
-- Antes: un solo pedido con todo + el lote de Transferencias POLO52 → MITO.
-- Ahora: pedido de MITO (lo que cubre el stock de MITO) y pedido «LLEGA DESDE POLO52» (el resto), los dos en la base MITO.
-- El lote POLO52 → MITO se sigue creando igual (la mercadería tiene que viajar).
-- Reparto por ítem (mismo cálculo que private.franquicias_lote_polo):
--   polo = mín(stock_polo, máx(0, cantidad − (stock_mito − stock_polo)));  mito = cantidad − polo.
-- El link del cliente no cambia: lo de Polo es interno.

alter table public.franquicias_propuestas
  add column if not exists dragon_pedido_polo text,
  add column if not exists dragon_polo_falta boolean not null default false;

-- Lo que toma el puente: cada ítem trae su parte de MITO y de Polo. También vuelve a tomar
-- las que ya tienen el pedido de MITO pero les falló el de Polo (dragon_polo_falta), hasta 5 intentos.
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
        where dragon_enviando_at is null and dragon_intentos < 5 and coalesce(unidades_confirmadas, 0) > 0
          and ((estado = 'confirmada' and dragon_pedido is null)
               or (estado = 'en_dragon' and dragon_polo_falta and dragon_pedido_polo is null))
        order by confirmada_at limit 5 for update skip locked)
    returning p.*)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'numero', t.numero, 'franquicia', t.franquicia, 'franquicia_nombre', t.franquicia_nombre,
           'cliente_id', t.cliente_id, 'cliente_nombre', t.cliente_nombre, 'tipo', t.tipo,
           'confirmada_at', t.confirmada_at, 'comentario', t.comentario,
           'dragon_pedido', t.dragon_pedido,
           'items', (select coalesce(jsonb_agg(jsonb_build_object(
                              'art', x.art, 'color', x.color, 'talle', x.talle, 'cantidad', x.cantidad,
                              'polo', x.polo, 'mito', x.cantidad - x.polo) order by x.orden), '[]'::jsonb)
                       from (select i.orden, i.art, i.color, i.talle, i.cantidad,
                                    least(greatest(0, i.stock_polo),
                                          greatest(0, i.cantidad - greatest(0, i.stock_mito - i.stock_polo))) as polo
                               from public.franquicias_propuesta_items i
                              where i.propuesta_id = t.id and coalesce(i.cantidad, 0) > 0) x))), '[]'::jsonb)
    into r from tomadas t;
  return r;
end $$;

-- Resultado: p_pedido = pedido de MITO (o el de Polo si todo salía de Polo), p_pedido_polo = pedido de Polo.
-- p_polo_falta = había unidades de Polo y su pedido no se pudo cargar (queda para reintentar).
drop function if exists public.franquicias_resultado_dragon(text, uuid, text, text);
create or replace function public.franquicias_resultado_dragon(
  p_token text, p_id uuid, p_pedido text, p_error text,
  p_pedido_polo text default null, p_polo_falta boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_estado text;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select estado into v_estado from public.franquicias_propuestas where id = p_id;
  if nullif(btrim(coalesce(p_pedido, '')), '') is not null then
    update public.franquicias_propuestas
       set estado = 'en_dragon', dragon_pedido = p_pedido,
           dragon_pedido_polo = coalesce(nullif(btrim(coalesce(p_pedido_polo, '')), ''), dragon_pedido_polo),
           dragon_polo_falta = coalesce(p_polo_falta, false),
           dragon_error = case when coalesce(p_polo_falta, false)
                               then left('Pedido de MITO cargado, falta el de Polo: ' || coalesce(p_error, 'sin detalle'), 500) end,
           dragon_at = coalesce(dragon_at, now()), dragon_enviando_at = null
     where id = p_id;
    -- El lote POLO52 → MITO, una sola vez (al pasar de confirmada a en_dragon).
    if v_estado = 'confirmada' then
      begin
        perform private.franquicias_lote_polo(p_id);
      exception when others then
        update public.franquicias_propuestas
           set dragon_error = left(coalesce(dragon_error || ' · ', '') || 'No se pudo crear la transferencia de Polo: ' || sqlerrm, 500)
         where id = p_id;
      end;
    end if;
  else
    update public.franquicias_propuestas
       set dragon_error = left(coalesce(p_error, 'Error sin detalle'), 500), dragon_enviando_at = null
     where id = p_id;
  end if;
end $$;

revoke all on function public.franquicias_resultado_dragon(text, uuid, text, text, text, boolean) from public;
grant execute on function public.franquicias_resultado_dragon(text, uuid, text, text, text, boolean) to anon, authenticated;

-- La descripción del lote de Polo nombra los dos pedidos.
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
      || coalesce(' · pedido Dragon Polo ' || p.dragon_pedido_polo, coalesce(' · pedido Dragon ' || p.dragon_pedido, ''))
      || ' · Polo → MITO',
    v_items, null);
end $$;
revoke all on function private.franquicias_lote_polo(uuid) from public, anon, authenticated;

-- Anulado en Dragon: también lo detecta si anulan el pedido de Polo.
create or replace function private.franquicias_pedido_anulado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.anulado then
    update public.franquicias_propuestas
       set dragon_anulado_at = coalesce(NEW.anulado_at, now()), dragon_anulado_por = NEW.anulado_por
     where (dragon_pedido = NEW.numero::text or dragon_pedido_polo = NEW.numero::text)
       and (cliente_id is null or cliente_id = NEW.cliente)
       and dragon_anulado_at is distinct from coalesce(NEW.anulado_at, now());
  else
    update public.franquicias_propuestas
       set dragon_anulado_at = null, dragon_anulado_por = null
     where (dragon_pedido = NEW.numero::text or dragon_pedido_polo = NEW.numero::text)
       and (cliente_id is null or cliente_id = NEW.cliente)
       and dragon_anulado_at is not null;
  end if;
  return null;
end $$;
