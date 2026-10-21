-- Franquicias con permiso propio (aplicado 2026-10-21)
--
-- Antes la pantalla usaba `mayorista.repos_piso`, el mismo del escaneo en piso (Mi repo).
-- Eso dejaba Franquicias —ventas, precios, propuestas y altas de pedidos en Dragon— a la
-- vista del rol Empleado, y obligaba a dar acceso al piso para que la viera Mayorista.
-- Ahora tiene su propia clave y se le asigna al rol Mayorista.

insert into public.permisos (clave, modulo, accion, label, orden)
values ('mayorista.franquicias.view', 'mayorista', 'franquicias.view', 'Ver Franquicias · reposición sugerida', 1020)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;

insert into public.rol_permisos (rol, permiso_clave)
values ('mayorista', 'mayorista.franquicias.view')
on conflict do nothing;

-- Las tablas del circuito pasan a mirar el permiso nuevo (ver sql/franquicias_propuestas.sql)
do $$
declare t text;
begin
  foreach t in array array['franquicias_contactos', 'franquicias_propuestas', 'franquicias_propuesta_items',
                           'franquicias_bases', 'franquicias_clientes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_hub', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.tengo_permiso(''mayorista.franquicias.view'')) with check (private.tengo_permiso(''mayorista.franquicias.view''))',
      t || '_hub', t);
  end loop;
end $$;
