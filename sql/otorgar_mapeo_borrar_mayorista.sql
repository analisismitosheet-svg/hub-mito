-- ---------------------------------------------------------------------------
-- Otorgar al rol "mayorista" el permiso de borrar del mapeo depósito.
--
-- El botón eliminar de /mayorista/mapeo/orden ya lo pide en el front
-- (src/pages/MapeoOrden.tsx: can('mayorista.mapeo.borrar')) y la RLS de
-- public.mapeo_deposito también (política mapeo_deposito_borrar), pero el rol
-- Mayorista no lo tenía, así que a los usuarios con ese rol no les aparecía.
--
-- Ejecutar en Supabase SQL Editor. Idempotente: se puede correr las veces que
-- haga falta sin duplicar filas.
-- ---------------------------------------------------------------------------

-- 1. Asegurar que el permiso exista en el catálogo
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.mapeo.borrar', 'mayorista', 'mapeo.borrar', 'Borrar del mapeo depósito', 952)
ON CONFLICT (clave) DO NOTHING;

-- 2. Otorgarlo al rol Mayorista
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'mayorista', 'mayorista.mapeo.borrar'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rol_permisos
  WHERE rol = 'mayorista' AND permiso_clave = 'mayorista.mapeo.borrar'
);

-- 3. Comprobar: tiene que devolver una fila
SELECT rol, permiso_clave
FROM public.rol_permisos
WHERE rol = 'mayorista' AND permiso_clave = 'mayorista.mapeo.borrar';
