-- ============================================================
-- Área WEB + rol Web (30/10/2026)
-- Ejecutar con: node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/area_web.sql
-- Idempotente.
--
-- El menú muestra el área a quien tenga area_web.view
-- (src/pages/Menu.tsx: can(`area_${id}.view`)). Adentro está Ventas web
-- (permiso tiendanube.view, ver sql/tiendanube.sql). El rol "web" trae los dos:
-- al registrar a alguien con rol Web ya ve el área y las ventas de la tienda.
-- ============================================================

INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('area_web.view', 'area_web', 'view', 'Ver área WEB', 270)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.roles (codigo, nombre, es_admin, protegido, orden) VALUES
  ('web', 'Web', false, false, 100)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'web', p.clave
FROM (VALUES ('area_web.view'), ('tiendanube.view')) AS p(clave)
WHERE NOT EXISTS (
  SELECT 1 FROM public.rol_permisos rp WHERE rp.rol = 'web' AND rp.permiso_clave = p.clave
);
