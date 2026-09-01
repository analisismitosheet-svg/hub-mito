-- ---------------------------------------------------------------------------
-- Fix: "bad request" al guardar permisos individuales de un usuario.
--
-- La tabla public.usuario_permisos tiene RLS con política de escritura
-- restringida, así que un admin autenticado no puede hacer upsert/delete
-- directo (400). Esta RPC SECURITY DEFINER valida que el llamante sea admin
-- y hace el trabajo de escritura con el rol definitor (bypasa RLS).
--
-- Uso (desde el front):
--   SELECT set_usuario_permisos(
--     uid,                 -- usuario a configurar
--     limpiar,             -- claves que vuelven al default (se borran)
--     grants,              -- claves a forzar como 'grant'
--     revokes              -- claves a forzar como 'revoke'
--   )
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_usuario_permisos(
  uid uuid,
  limpiar text[],
  grants text[],
  revokes text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.es_admin() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Quitar los overrides que vuelven al default (ya no hacen falta en la tabla)
  DELETE FROM public.usuario_permisos
  WHERE usuario_id = uid
    AND permiso_clave = ANY(COALESCE(limpiar, ARRAY[]::text[]));

  -- Aplicar fuerzas positivas / negativas
  DELETE FROM public.usuario_permisos
  WHERE usuario_id = uid
    AND permiso_clave = ANY(COALESCE(grants, ARRAY[]::text[]) || COALESCE(revokes, ARRAY[]::text[]));

  INSERT INTO public.usuario_permisos (usuario_id, permiso_clave, efecto)
  SELECT uid, g, 'grant'
  FROM unnest(COALESCE(grants, ARRAY[]::text[])) g;

  INSERT INTO public.usuario_permisos (usuario_id, permiso_clave, efecto)
  SELECT uid, r, 'revoke'
  FROM unnest(COALESCE(revokes, ARRAY[]::text[])) r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_usuario_permisos(uuid, text[], text[], text[]) TO authenticated;
