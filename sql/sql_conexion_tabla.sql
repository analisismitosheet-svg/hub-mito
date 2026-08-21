-- ============================================================
-- Tabla sql_conexion: configuración del enlace al SQL Server.
-- Ejecutar en Supabase SQL Editor
--
-- Fila única (id = 1) con la URL SAS del trigger HTTP del Logic App
-- y el tope de filas por consulta.
--
-- SEGURIDAD: la URL contiene el secreto (sig) del trigger, así que la
-- tabla tiene RLS sin ninguna policy de lectura pública: SOLO administradores
-- leen/escriben desde la app. Las funciones serverless de Vercel la leen con
-- SUPABASE_SERVICE_ROLE_KEY (bypass RLS), por eso el resto de los usuarios
-- puede consultar datos sin ver el secreto.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sql_conexion (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  logicapp_url text,
  max_rows int,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sql_conexion ENABLE ROW LEVEL SECURITY;

-- Solo administradores: leer/guardar la configuración
DROP POLICY IF EXISTS "sql_conexion_admin_all" ON public.sql_conexion;
CREATE POLICY "sql_conexion_admin_all" ON public.sql_conexion
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND (u.rol = 'administrador' OR u.es_admin = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid() AND (u.rol = 'administrador' OR u.es_admin = true)
    )
  );

COMMENT ON TABLE public.sql_conexion IS
  'Configuración de la conexión al SQL Server (Logic App vía Gateway). Fila única id=1. La URL incluye el SAS del trigger: secreto, solo admins.';
