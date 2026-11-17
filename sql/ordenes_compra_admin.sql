-- Órdenes de compras: permiso de administrador del módulo (17/11/2026)
--   ordenes_compra.admin → lo mismo que el admin del hub, solo en órdenes de compra:
--   borrar OC, autorizadores (config, árbol, contactos, claves del link) y responsables de gastos.
--   Se lo damos a Cecilia (contabilidad@) junto con todos los demás permisos de OC.

insert into public.permisos (clave, modulo, accion, label, orden) values
  ('ordenes_compra.admin', 'ordenes_compra', 'admin', 'Órdenes de compras: administrador del módulo (borrar, autorizadores y claves)', 966)
on conflict (clave) do update set label = excluded.label, orden = excluded.orden;

create or replace function private.oc_soy_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select private.es_admin() or private.tengo_permiso('ordenes_compra.admin')
$$;
grant execute on function private.oc_soy_admin() to authenticated;

-- Las funciones de OC que eran «solo admin» pasan a aceptar también el admin del módulo
do $$
declare f record; def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('oc_arbol_guardar', 'oc_borrar', 'oc_clave_desbloquear', 'oc_clave_guardar', 'oc_claves_estado',
                         'oc_config_guardar', 'oc_contactos', 'oc_responsables_gastos')
  loop
    def := pg_get_functiondef(f.oid);
    if position('private.es_admin()' in def) > 0 then
      execute replace(def, 'private.es_admin()', 'private.oc_soy_admin()');
    end if;
  end loop;
end $$;

-- Cecilia: todos los permisos de órdenes de compra
insert into public.usuario_permisos (usuario_id, permiso_clave, efecto)
select 'cff2bfc4-740e-4c90-bd52-79e56eaf7f36'::uuid, p.clave, 'grant'
  from public.permisos p
 where p.clave like 'ordenes\_compra.%'
   and not exists (select 1 from public.usuario_permisos up
                    where up.usuario_id = 'cff2bfc4-740e-4c90-bd52-79e56eaf7f36' and up.permiso_clave = p.clave);
