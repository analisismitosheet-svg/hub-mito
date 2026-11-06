-- Órdenes de compras: la OC se crea sola en Dragon cuando la autorizan (decisión del 06/11/2026).
-- Antes había tres botones al pie del formulario; ahora hay uno solo que hace lo que corresponde
-- (pedir autorización, o crear en Dragon si ya está autorizada) y, al autorizarse por Telegram,
-- por el link o tildando en el hub, este trigger deja la OC en cola para el puente
-- (sync-oc-dragon.js, cada 1 min). Si faltan datos de Dragon no la manda: queda en «error»
-- con lo que falta y Compras la reintenta después de completarla.
-- Además Dragon ahora espera la autorización: oc_mandar_dragon no la deja pasar antes.
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_dragon_auto.sql

-- Qué le falta a una OC para ir a Dragon (null = nada)
create or replace function private.oc_falta_dragon(o public.ordenes_compra) returns text
language sql stable as $$
  select case
    when coalesce(o.dragon_proveedor, '') = '' then 'Falta el proveedor de Dragon'
    when coalesce(o.dragon_motivo, '') = '' then 'Falta el motivo (es obligatorio en Dragon)'
    when coalesce(o.dragon_base, '') not in ('INDOD') then 'Por ahora solo se puede mandar a DRAGONFISH_INDOD'
    when not exists (select 1 from jsonb_array_elements(coalesce(o.dragon_items, '[]'::jsonb)) i
                      where coalesce(i ->> 'articulo', '') <> '' and coalesce((i ->> 'cantidad')::numeric, 0) > 0)
      then 'Cargá al menos un artículo con cantidad'
  end
$$;

create or replace function private.oc_dragon_al_autorizar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  falta text;
  quien text := coalesce(new.pasos -> 'autor' ->> 'por', 'autorizador');
begin
  if new.pasos ? 'autor' and not coalesce(old.pasos ? 'autor', false)
     and new.dragon and not new.importada and new.cancelada_at is null
     and coalesce(new.dragon_estado, '') not in ('pendiente', 'enviando', 'ok') then
    falta := private.oc_falta_dragon(new);
    if falta is null then
      new.dragon_estado := 'pendiente';
      new.dragon_error := null;
      new.dragon_por := format('autorizó %s', quien);
      insert into public.ordenes_compra_eventos (numero, por, texto)
      values (new.numero, 'sistema', format('mandó la OC a Dragon sola al autorizarse (DRAGONFISH_%s)', new.dragon_base));
    else
      new.dragon_estado := 'error';
      new.dragon_error := format('No se mandó sola al autorizarse: %s', falta);
      insert into public.ordenes_compra_eventos (numero, por, texto)
      values (new.numero, 'sistema', format('no se mandó sola a Dragon al autorizarse: %s', falta));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ordenes_compra_dragon_al_autorizar on public.ordenes_compra;
create trigger ordenes_compra_dragon_al_autorizar
  before update of pasos on public.ordenes_compra
  for each row execute function private.oc_dragon_al_autorizar();

-- Crear en Dragon a mano (Compras): solo con la OC autorizada
create or replace function public.oc_mandar_dragon(p_numero int) returns void
language plpgsql security definer set search_path = public as $$
declare o public.ordenes_compra; falta text;
begin
  if not private.tengo_permiso('ordenes_compra.compras') then raise exception 'Solo Compras puede crear la OC en Dragon' using errcode = '42501'; end if;
  select * into o from public.ordenes_compra where numero = p_numero for update;
  if o.numero is null then raise exception 'No existe la OC %', p_numero; end if;
  if not o.dragon then raise exception 'La OC no tiene tildado «Esta OC va a Dragon»'; end if;
  if o.dragon_estado in ('enviando', 'ok') then raise exception 'La OC ya se mandó a Dragon'; end if;
  if o.cancelada_at is not null then raise exception 'La OC está cancelada'; end if;
  if not (o.pasos ? 'autor') then raise exception 'La OC todavía no está autorizada: se crea sola en Dragon cuando la autoricen'; end if;
  falta := private.oc_falta_dragon(o);
  if falta is not null then raise exception '%', falta; end if;
  update public.ordenes_compra set dragon_estado = 'pendiente', dragon_error = null, dragon_por = private.oc_mi_nombre(), actualizada_at = now()
   where numero = p_numero;
  perform private.oc_evento(p_numero, format('mandó la OC a Dragon (DRAGONFISH_%s)', o.dragon_base));
end $$;

grant execute on function public.oc_mandar_dragon(int) to authenticated;
