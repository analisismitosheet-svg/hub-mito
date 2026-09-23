-- =====================================================
-- PARTE 2 (cierre) — SEGURIDAD DEL INGRESO DE EMPLEADOS A PISO
-- Aplicar DESPUÉS de publicar el hub que usa empleados_basico y escanear_codigo
-- (si se aplica antes, las pantallas viejas se quedan sin lista de empleados
-- y el escaneo viejo del piso deja de guardar).
--  - El piso ya no hace UPDATE directo en mayorista_items (solo vía funciones).
--  - La nómina completa (empleados) queda solo para RR. HH. / admin.
-- =====================================================

BEGIN;

-- El piso ya no escribe directo en la tabla (solo por las funciones de arriba)
DROP POLICY IF EXISTS "mayorista_items_piso_update" ON public.mayorista_items;

-- -----------------------------------------------------
-- 4. Nómina (empleados): solo RR. HH. / admin
-- -----------------------------------------------------
DROP POLICY IF EXISTS "empleados_auth_lectura" ON public.empleados;
DROP POLICY IF EXISTS "empleados_leer" ON public.empleados;
DROP POLICY IF EXISTS "empleados_auth_alta" ON public.empleados;
DROP POLICY IF EXISTS "empleados_auth_edicion" ON public.empleados;
-- (se mantiene "empleados_admin": admin puede todo)

DROP POLICY IF EXISTS "empleados_rrhh_ver" ON public.empleados;
CREATE POLICY "empleados_rrhh_ver" ON public.empleados
  FOR SELECT TO authenticated
  USING (private.tiene_permiso('rrhh.empleados.view'));

DROP POLICY IF EXISTS "empleados_rrhh_alta" ON public.empleados;
CREATE POLICY "empleados_rrhh_alta" ON public.empleados
  FOR INSERT TO authenticated
  WITH CHECK (private.tiene_permiso('rrhh.empleados.create'));

DROP POLICY IF EXISTS "empleados_rrhh_edicion" ON public.empleados;
CREATE POLICY "empleados_rrhh_edicion" ON public.empleados
  FOR UPDATE TO authenticated
  USING (private.tiene_permiso('rrhh.empleados.edit'))
  WITH CHECK (private.tiene_permiso('rrhh.empleados.edit'));

DROP POLICY IF EXISTS "empleados_rrhh_baja" ON public.empleados;
CREATE POLICY "empleados_rrhh_baja" ON public.empleados
  FOR DELETE TO authenticated
  USING (private.tiene_permiso('rrhh.empleados.delete'));

COMMIT;
