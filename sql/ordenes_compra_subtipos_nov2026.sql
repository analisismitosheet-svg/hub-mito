-- Órdenes de compras: nuevos subtipos y áreas (pedido del 19/11/2026).
--   Producto : + Mercadería, + Insumos de producción; fuera Alquiler (no lleva OC).
--   Gastos   : fuera Alquiler, Procesos de producción, Envíos, Honorarios, Limpieza (pasa a Servicios);
--              «Mantenimiento y lámparas» pasa a «Mantenimiento»; + Librería, + Viáticos, + Marketing.
--   Servicios: «Reparaciones» pasa a «Mantenimiento»; + Transportes, Honorarios, Comex, Limpieza,
--              Marketing, Abono mensual, Diseño.
--   Talleres : + Proceso de estampa, + Limpieza de producción.
-- Los que se sacan quedan desactivados (activo = false): las OC viejas que los tienen los conservan.
-- Renombrar mantiene el id, así que los autorizadores elegidos en ese nodo siguen.
-- Áreas: oc_mis_areas suma Marketing, RRHH, Sistemas, Recepción y Producción (para ver las OC del área).
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_subtipos_nov2026.sql

-- Bajas
update public.ordenes_compra_subtipos set activo = false, actualizado_at = now()
 where activo and (
       (tipo = 'Producto' and lower(nombre) = 'alquiler')
    or (tipo = 'Gastos' and (lower(nombre) in ('alquiler', 'limpieza') or nombre ilike 'proceso%producci%'
                             or nombre ilike 'env%o%' or lower(nombre) = 'honorarios')));

-- Renombres
update public.ordenes_compra_subtipos set nombre = 'Mantenimiento', actualizado_at = now()
 where activo and tipo = 'Gastos' and nombre = 'Mantenimiento y lámparas';
update public.ordenes_compra_subtipos set nombre = 'Mantenimiento', actualizado_at = now()
 where activo and tipo = 'Servicios' and nombre = 'Reparaciones';

-- Altas (si ya existe activo con ese nombre, no se duplica)
insert into public.ordenes_compra_subtipos (tipo, nombre, orden)
select t.tipo, t.nombre, t.orden from (values
  ('Producto', 'Mercadería', 3), ('Producto', 'Insumos de producción', 4),
  ('Gastos', 'Librería', 2), ('Gastos', 'Viáticos', 3), ('Gastos', 'Marketing', 4),
  ('Servicios', 'Transportes', 3), ('Servicios', 'Honorarios', 4), ('Servicios', 'Comex', 5), ('Servicios', 'Limpieza', 6),
  ('Servicios', 'Marketing', 7), ('Servicios', 'Abono mensual', 8), ('Servicios', 'Diseño', 9),
  ('Talleres', 'Proceso de estampa', 4), ('Talleres', 'Limpieza de producción', 5)
) t(tipo, nombre, orden)
where not exists (select 1 from public.ordenes_compra_subtipos s
                   where s.activo and s.tipo = t.tipo and lower(trim(s.nombre)) = lower(t.nombre));

-- Orden prolijo de Gastos (Mantenimiento, Librería, Viáticos, Marketing)
update public.ordenes_compra_subtipos set orden = 1 where activo and tipo = 'Gastos' and nombre = 'Mantenimiento';

-- Áreas del usuario (por los permisos de área del menú). Mismo orden que AREA_POR_PERMISO en src/lib/ordenesCompra.ts
create or replace function private.oc_mis_areas() returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when private.tengo_permiso('area_compras.view') then 'Compras' end,
    case when private.tengo_permiso('area_deposito.view') then 'Depósito' end,
    case when private.tengo_permiso('area_diseno.view') then 'Diseño' end,
    case when private.tengo_permiso('area_arquitectura.view') then 'Arquitectura' end,
    case when private.tengo_permiso('area_administracion.view') then 'Administración' end,
    case when private.tengo_permiso('area_marketing.view') then 'Marketing' end,
    case when private.tengo_permiso('area_rrhh.view') then 'RRHH' end,
    case when private.tengo_permiso('area_sistemas.view') then 'Sistemas' end,
    case when private.tengo_permiso('area_recepcion.view') then 'Recepción' end,
    case when private.tengo_permiso('area_produccion.view') then 'Producción' end
  ], null)
$$;
