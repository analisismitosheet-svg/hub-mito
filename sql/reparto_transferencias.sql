-- =====================================================================================
-- Reposiciones / Transferencias > Reparto manual (/transferencias/reparto)
-- 18/11/2026. Se aplica una vez en el hub (Supabase). No toca el SQL Server.
--
-- 1) reparto_cargar_transferencias: «Cargar en Transferencias» del reparto. Crea un lote más de
--    Transferencias (origen = local que bajó, destino = el que subió) con la observación en
--    transfer_lotes.motivo (Transferencias ya la muestra al lado del nombre). Reusa
--    private.cascada_crear_lote: no repite un lote con el mismo nombre en 7 días; tipo VENTA/HUECO.
-- 2) reparto_rutas_vehiculos: locales que cada vehículo todavía tiene que pasar hoy (Tracking),
--    para marcarlos en la grilla. SECURITY DEFINER: el Tracking es del área Administradores
--    (tracking.view) y esto lo usa quien tiene transferencias.import; devuelve lo mínimo.
-- =====================================================================================

create or replace function public.reparto_cargar_transferencias(p_nombre text, p_obs text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not private.tiene_permiso('transferencias.import') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(coalesce(p_obs, '')) > 300 then
    raise exception 'La observación tiene más de 300 caracteres' using errcode = '22023';
  end if;
  return private.cascada_crear_lote(p_nombre, coalesce(nullif(btrim(p_obs), ''), 'Reparto manual'), p_items, auth.uid());
end $$;

revoke all on function public.reparto_cargar_transferencias(text, text, jsonb) from public, anon;
grant execute on function public.reparto_cargar_transferencias(text, text, jsonb) to authenticated;

-- [{ vehiculo, color, ultima_at, pendientes: [{ base_id, hora_limite }] }]
-- ultima_at = última ubicación recibida (para mostrar «En ruta · hace N min» / «Sin señal»).
create or replace function public.reparto_rutas_vehiculos(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Argentina/Cordoba')::date);
  v_out jsonb;
begin
  if not (private.tiene_permiso('transferencias.import') or private.tiene_permiso('tracking.view')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'vehiculo'), '[]'::jsonb) into v_out
    from (
      select jsonb_build_object(
               'vehiculo', v.nombre,
               'color', v.color,
               'ultima_at', (select max(u.at) from tracking_ubicaciones u
                              where u.vehiculo_id = v.id and u.at > now() - interval '1 day'),
               'pendientes', coalesce((
                 select jsonb_agg(jsonb_build_object('base_id', c.base_id, 'hora_limite', to_char(c.hora_limite, 'HH24:MI'))
                                  order by c.hora_limite nulls last, c.base_id)
                   from public.tracking_controles_dia(v_fecha) c
                  where c.vehiculo_id = v.id and c.paso_at is null), '[]'::jsonb)
             ) as x
        from tracking_vehiculos v
       where v.activo
         and exists (select 1 from tracking_recorridos r where r.vehiculo_id = v.id)
    ) t;
  return v_out;
end $$;

revoke all on function public.reparto_rutas_vehiculos(date) from public, anon;
grant execute on function public.reparto_rutas_vehiculos(date) to authenticated;
