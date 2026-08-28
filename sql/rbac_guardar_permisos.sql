-- ============================================================================
-- GUARDADO CENTRALIZADO DE PERMISOS (SOlUCIONA RLS en INSERT/UPDATE)
--
-- El panel escribía en rol_permisos / role_scope_settings / submodule_areas
-- directamente desde el cliente, y RLS bloqueaba el INSERT (403). 
--
-- Este RPC es SECURITY DEFINER (bypasa RLS) y realiza TODAS las escrituras del
-- guardado de forma centralizada, verificando que el usuario logueado sea
-- ADMIN (tiene un rol con es_admin). El frontend llama a un único RPC.
--
-- Ejecutar en Supabase SQL Editor. IDEMPOTENTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) helper: ¿el usuario logueado es admin?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.es_admin_user(_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuario_roles ur
    JOIN public.roles r ON r.codigo = ur.rol_codigo
    WHERE ur.usuario_id = _uid AND r.es_admin
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) guardar_permisos(rol, permisos[], scopes jsonb)
--    _permisos: claves concedidas  (ej. ['compras.reposiciones.read', ...])
--    _scopes:   jsonb { "<moduleId>:<submoduleId>": "scope_value", ... }
--    Regenera rol_permisos + role_scope_settings y luego sincroniza
--    submodule_areas (el menú sigue a los permisos concedidos).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_permisos(
  _rol text,
  _permisos text[],
  _scopes jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  k text;
BEGIN
  -- solo administradores
  IF NOT public.es_admin_user(v_uid) THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol administrador';
  END IF;

  -- 1) permisos del rol
  DELETE FROM public.rol_permisos WHERE rol = _rol;
  IF _permisos IS NOT NULL AND array_length(_permisos, 1) > 0 THEN
    INSERT INTO public.rol_permisos (rol, permiso_clave)
    SELECT _rol, unnest(_permisos);
  END IF;

  -- 2) alcances por (rol, submódulo, área)
  DELETE FROM public.role_scope_settings WHERE role_codigo = _rol;
  FOR k IN SELECT jsonb_object_keys(COALESCE(_scopes, '{}'::jsonb)) LOOP
    INSERT INTO public.role_scope_settings (role_codigo, submodule_id, module_id, scope_value)
    VALUES (
      _rol,
      (split_part(k, ':', 2))::bigint,
      (split_part(k, ':', 1))::bigint,
      _scopes->>k
    );
  END LOOP;

  -- 3) sincronizar submodule_areas (menú sigue a los permisos)
  DELETE FROM public.submodule_areas;
  INSERT INTO public.submodule_areas (submodule_id, module_id)
  SELECT DISTINCT p.submodule_id, p.module_id
  FROM public.permissions p
  WHERE EXISTS (
    SELECT 1 FROM public.rol_permisos rp WHERE rp.permiso_clave = p.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.guardar_permisos(text, text[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.es_admin_user(uuid) TO authenticated;
