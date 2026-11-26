-- Compras > Análisis ventas (/compras/analisis-ventas). 26/11/2026.
-- Permiso propio SIN asignar a ningún rol: por ahora entra solo el admin (es_admin ve todo).
-- Para abrírselo a alguien más: Roles o Usuarios → tildar «Ver análisis de ventas».
-- Los datos no están en Supabase: los calcula el Puente SQL (puente-sql/analisis-ventas.js) y pasan por
-- /api/sql/analisis-ventas, que pide este permiso con public.api_autorizado.
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('analisis_ventas.view', 'compras', 'view', 'Ver análisis de ventas', 885)
ON CONFLICT (clave) DO NOTHING;
