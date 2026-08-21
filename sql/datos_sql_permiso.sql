-- ============================================================
-- Permiso: Datos SQL (vistas del SQL Server vía /api/sql)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('datos_sql.view', 'sistemas', 'datos_sql.view', 'Ver datos SQL (vistas)', 800)
ON CONFLICT (clave) DO NOTHING;

-- Luego, desde Usuarios/Roles, otorgar 'datos_sql.view' a quien corresponda.
