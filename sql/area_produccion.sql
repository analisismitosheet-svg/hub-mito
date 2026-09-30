-- ============================================================
-- Área Producción + rol Producción
-- Ejecutar en Supabase SQL Editor. Idempotente. (Ya aplicado en hub-mito.)
--
-- El menú muestra el área a quien tenga area_produccion.view
-- (src/pages/Menu.tsx: can(`area_${id}.view`)); el rol "produccion" lo trae.
-- Las apps que se sumen al área traen sus propios permisos.
-- ============================================================

INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('area_produccion.view', 'area_produccion', 'view', 'Ver área Producción', 250)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.roles (codigo, nombre, es_admin, protegido, orden) VALUES
  ('produccion', 'Produccion', false, false, 100)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'produccion', 'area_produccion.view'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rol_permisos WHERE rol = 'produccion' AND permiso_clave = 'area_produccion.view'
);
