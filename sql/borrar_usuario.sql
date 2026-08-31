-- ---------------------------------------------------------------------------
-- borrar_usuario: elimina SOLO el perfil del usuario en public.usuarios
-- (NO toca auth.users, por lo que la cuenta de Supabase Auth sigue existiendo).
-- Limpia también sus roles y permisos individuales para no dejar registros huérfanos.
-- Requiere ser administrador.
--
-- Ejecutar en el SQL Editor de Supabase una sola vez.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.borrar_usuario(uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.es_admin() THEN
    RAISE EXCEPTION 'No autorizado: se requiere ser administrador';
  END IF;

  DELETE FROM public.usuario_permisos WHERE usuario_id = uid;
  DELETE FROM public.usuario_roles WHERE usuario_id = uid;
  DELETE FROM public.usuarios WHERE id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.borrar_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.borrar_usuario(uuid) TO authenticated;
