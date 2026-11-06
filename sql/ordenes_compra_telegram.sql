-- Órdenes de compras: autorizar con los botones del chat de Telegram, sin clave (decisión del 06/11/2026).
-- Quién es lo garantiza el servidor: el botón solo vale desde el chat vinculado al teléfono de ese envío.
-- Por eso solo la puede llamar el service role. Misma lógica que oc_link_responder: si otro ya respondió
-- no cambia nada y devuelve quién fue.
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_telegram.sql

create or replace function public.oc_telegram_responder(p_envio bigint, p_autoriza boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.ordenes_compra_whatsapp;
  o public.ordenes_compra;
begin
  select * into e from public.ordenes_compra_whatsapp where id = p_envio;
  if e.id is null then return jsonb_build_object('error', 'envio'); end if;
  select * into o from public.ordenes_compra where numero = e.numero for update;
  if not (o.pasos ? 'autor') and o.cancelada_at is null then
    update public.ordenes_compra_whatsapp set respuesta = case when p_autoriza then 'SI' else 'NO' end, respondio_at = now() where id = e.id;
    if p_autoriza then
      update public.ordenes_compra
         set pasos = pasos || jsonb_build_object('autor', jsonb_build_object('por', e.nombre, 'at', now(), 'via', 'telegram')),
             actualizada_at = now()
       where numero = o.numero;
      insert into public.ordenes_compra_eventos (numero, por, texto) values (o.numero, e.nombre, 'autorizó la OC desde Telegram');
    else
      update public.ordenes_compra
         set cancelada_at = now(), cancelada_por = e.nombre, no_autorizada = true, actualizada_at = now(),
             cancelada_motivo = 'No autorizada (Telegram)'
       where numero = o.numero;
      insert into public.ordenes_compra_eventos (numero, por, texto) values (o.numero, e.nombre, 'NO autorizó la OC desde Telegram');
    end if;
  end if;
  return jsonb_build_object('oc', private.oc_link_datos(e));
end $$;

revoke all on function public.oc_telegram_responder(bigint, boolean) from public, anon, authenticated;
grant execute on function public.oc_telegram_responder(bigint, boolean) to service_role;
