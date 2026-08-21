-- ============================================================
-- Config_app: clave 'sql_vistas' (vistas del SQL Server expuestas)
-- Ejecutar en Supabase SQL Editor
--
-- Lectura: cualquier autenticado (la necesita DatosSql y el proxy /api/sql).
-- Escritura: solo administradores, desde Configuraciones > Conexión SQL.
-- ============================================================

-- 1. SELECT para autenticados (aditivo; si ya existe una policy general, no molesta)
DROP POLICY IF EXISTS "config_app_sql_vistas_select" ON public.config_app;
CREATE POLICY "config_app_sql_vistas_select" ON public.config_app
  FOR SELECT TO authenticated
  USING (clave = 'sql_vistas');

-- 2. INSERT solo admin
DROP POLICY IF EXISTS "config_app_sql_vistas_insert" ON public.config_app;
CREATE POLICY "config_app_sql_vistas_insert" ON public.config_app
  FOR INSERT TO authenticated
  WITH CHECK (
    clave = 'sql_vistas'
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND (u.rol = 'administrador' OR u.es_admin = true)
    )
  );

-- 3. UPDATE solo admin
DROP POLICY IF EXISTS "config_app_sql_vistas_update" ON public.config_app;
CREATE POLICY "config_app_sql_vistas_update" ON public.config_app
  FOR UPDATE TO authenticated
  USING (
    clave = 'sql_vistas'
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND (u.rol = 'administrador' OR u.es_admin = true)
    )
  )
  WITH CHECK (
    clave = 'sql_vistas'
    AND EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND (u.rol = 'administrador' OR u.es_admin = true)
    )
  );
