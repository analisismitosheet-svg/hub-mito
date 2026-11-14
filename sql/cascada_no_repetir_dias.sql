-- Cascada automática: no repetir días de venta (14/11/2026).
-- El 13/11 y el 14/11 salieron dos lotes «CASCADA 12-11» (el sábado no hay repo y la cascada
-- volvió a tomar los días de la última repo cargada). El control por nombre exacto no lo vio
-- porque el nombre empieza con la fecha en que corre. El Puente (programador.js) pide los
-- nombres de los lotes de cascada recientes, saca de ahí los días de venta ya cubiertos y no
-- los vuelve a cargar.
create or replace function public.cascada_lotes_recientes_puente(p_token text)
 returns text[]
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return coalesce((select array_agg(l.nombre order by l.created_at)
                     from public.transfer_lotes l
                    where l.nombre like '% - CASCADA %'
                      and l.created_at >= now() - interval '21 days'), '{}');
end $$;
revoke all on function public.cascada_lotes_recientes_puente(text) from public;
grant execute on function public.cascada_lotes_recientes_puente(text) to anon, authenticated;
