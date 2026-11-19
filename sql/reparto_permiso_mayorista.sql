-- Reparto manual para el rol Mayorista, solo ver (2026-11-19)
--
-- Reparto manual pedía transferencias.import, que además abre toda Transferencias (importar
-- el Excel, repo diaria, cascada) y deja cargar lotes y pedidos en Dragon. Para que Mayorista
-- lo pueda ver va una clave propia: transferencias.reparto. Con ella se entra a la pantalla,
-- se arma el reparto y se baja el Excel; cargar el lote (reparto_cargar_transferencias) y los
-- pedidos en Dragon (/api/sql/reparto modo revisar/cargar) siguen pidiendo transferencias.import.

insert into public.permisos (clave, modulo, accion, label, orden)
values ('transferencias.reparto', 'transferencias', 'reparto', 'Ver Reparto manual (sin cargar lotes ni pedidos)', 73)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion, orden = excluded.orden;

insert into public.rol_permisos (rol, permiso_clave)
values ('mayorista', 'transferencias.reparto')
on conflict do nothing;

-- Los vehículos en ruta de la grilla (solo lectura) también para quien solo ve el reparto
create or replace function public.reparto_rutas_vehiculos(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Argentina/Cordoba')::date);
  v_out jsonb;
begin
  if not (private.tiene_permiso('transferencias.import') or private.tiene_permiso('transferencias.reparto') or private.tiene_permiso('tracking.view')) then
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
