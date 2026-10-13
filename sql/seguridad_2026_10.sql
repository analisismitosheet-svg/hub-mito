-- =====================================================
-- Revisión de seguridad (octubre 2026). Idempotente. Cada bloque = un hallazgo.
-- =====================================================

-- ---- #1 Fotos de DNI (Cuentas amigos) ----
-- Antes: bucket público y lectura para `public` -> cualquiera sin sesión listaba y bajaba
-- los DNI; cualquier logueado subía o pisaba archivos. Ahora: bucket privado, mismos
-- permisos que la tabla cuentas_amigos (tiene_permiso ya exige usuario aprobado) y la
-- pantalla muestra las fotos con URL firmada.
UPDATE storage.buckets
   SET public = false, file_size_limit = 10485760, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
 WHERE id = 'dni';
DROP POLICY IF EXISTS dni_public_read ON storage.objects;
DROP POLICY IF EXISTS dni_auth_insert ON storage.objects;
DROP POLICY IF EXISTS dni_auth_update ON storage.objects;
DROP POLICY IF EXISTS dni_leer ON storage.objects;
DROP POLICY IF EXISTS dni_subir ON storage.objects;
DROP POLICY IF EXISTS dni_actualizar ON storage.objects;
CREATE POLICY dni_leer ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dni' AND private.tiene_permiso('cuentas_amigos.view'));
CREATE POLICY dni_subir ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dni' AND (private.tiene_permiso('cuentas_amigos.create') OR private.tiene_permiso('cuentas_amigos.edit')));
CREATE POLICY dni_actualizar ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'dni' AND private.tiene_permiso('cuentas_amigos.edit'))
  WITH CHECK (bucket_id = 'dni' AND private.tiene_permiso('cuentas_amigos.edit'));

-- La tabla tenía además una lectura abierta a cualquier logueado (qual = true) que
-- anulaba ca_view (cuentas_amigos.view): nombres, DNI y teléfonos para cualquiera.
DROP POLICY IF EXISTS cuentas_amigos_select_auth ON public.cuentas_amigos;

-- ---- #2 Endpoints /api que solo validaban el JWT ----
-- El registro es abierto y el usuario nuevo queda 'pendiente' pero con un JWT válido.
-- Los endpoints ahora llaman a esta RPC con el JWT del usuario: aprobado (o admin) y,
-- si se pasan claves, con al menos uno de esos permisos.
CREATE OR REPLACE FUNCTION public.api_autorizado(p_claves text[] DEFAULT '{}')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (private.es_admin() OR private.usuario_aprobado())
     AND (coalesce(cardinality(p_claves), 0) = 0
          OR private.es_admin()
          OR EXISTS (SELECT 1 FROM unnest(p_claves) AS c WHERE private.tiene_permiso(c)))
$$;
REVOKE ALL ON FUNCTION public.api_autorizado(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.api_autorizado(text[]) TO authenticated;
