-- Reparto manual: el rol Mayorista también carga (2026-11-19, sigue a sql/reparto_permiso_mayorista.sql)
--
-- transferencias.reparto pasa de "solo ver" a ver y cargar: «Cargar en Transferencias»
-- (reparto_cargar_transferencias) y los pedidos de venta en Dragon (/api/sql/reparto, que ya
-- acepta la clave). Sigue sin abrir el resto de Transferencias (Excel, repo diaria, cascada).

update public.permisos
   set label = 'Reparto manual: ver y cargar (lote y pedidos en Dragon), sin el resto de Transferencias'
 where clave = 'transferencias.reparto';

create or replace function public.reparto_cargar_transferencias(p_nombre text, p_obs text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (private.tiene_permiso('transferencias.import') or private.tiene_permiso('transferencias.reparto')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(coalesce(p_obs, '')) > 300 then
    raise exception 'La observación tiene más de 300 caracteres' using errcode = '22023';
  end if;
  return private.cascada_crear_lote(p_nombre, coalesce(nullif(btrim(p_obs), ''), 'Reparto manual'), p_items, auth.uid());
end $$;

revoke all on function public.reparto_cargar_transferencias(text, text, jsonb) from public, anon;
grant execute on function public.reparto_cargar_transferencias(text, text, jsonb) to authenticated;
