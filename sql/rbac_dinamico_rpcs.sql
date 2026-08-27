-- ============================================================================
-- SISTEMA DE ROLES Y PERMISOS DINÁMICO (Supabase) — RPCs
--   * permisos_role(codigo  text)  -> lista plana de permisos del rol
--   * permisos_tree(codigo text)   -> árbol JSON modules/submodules/actions
--                                    con estado (concedido) por rol
--   * get_scope(codigo, subm)      -> scope_value de role_scope_settings
--   * mis_permisos()  (BC, ampliado) -> permisos del usuario logueado
--   * scopes_usuario()             -> { resource: scope } del usuario
--
-- La lógica "backend" pedida (can/applyScope) vive en RLS + estos RPC.
-- Ejecutar DESPUÉS de rbac_dinamico_schema.sql. IDEMPOTENTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) permisos del ROL (plano): 'locales.reposiciones.read', ...
--    Fuente: role_has_permissions -> role_permisos legacy + modelo normalizado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.permisos_role(codigo text)
RETURNS TABLE (permiso text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.name AS permiso
  FROM public.permissions p
  JOIN public.role_permisos rp ON rp.permiso_clave = p.name
  WHERE rp.rol = codigo
  UNION
  SELECT permiso_clave FROM public.rol_permisos WHERE rol = codigo
  ORDER BY 1;
$$;

-- ---------------------------------------------------------------------------
-- 2) ÁRBOL DE PERMISOS para el panel admin
--    Estructura JSON:
--    [{ module:{key,name,icon}, submodules:[
--         { key,name,has_scope, scope,
--           actions:[ {key,label, has:bool} ] } ] }]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.permisos_tree(codigo text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'module', jsonb_build_object('key', m.key, 'name', m.name, 'icon', m.icon),
      'submodules', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', sm.key,
            'name', sm.name,
            'has_scope', sm.has_scope,
            'scope', COALESCE(
              (SELECT rs.scope_value FROM public.role_scope_settings rs
                WHERE rs.role_codigo = codigo AND rs.submodule_id = sm.id), 'none'),
            'actions', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'key', a.key,
                  'label', a.label,
                  'has', EXISTS (
                    SELECT 1 FROM public.role_permisos rp WHERE rp.rol = codigo
                      AND rp.permiso_clave = p.name
                  )
                ) ORDER BY a.id
              )
              FROM public.permissions p
              JOIN public.actions a ON a.id = p.action_id
              WHERE p.submodule_id = sm.id
            ), '[]'::jsonb)
          ) ORDER BY sm.id
        )
        FROM public.submodules sm
        WHERE sm.module_id = m.id AND sm.is_active
      ), '[]'::jsonb)
    ) ORDER BY m."order"
  )
  INTO result
  FROM public.modules m
  WHERE m.is_active
  ORDER BY m."order";

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) get_scope: alcance configurado para un rol + submódulo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_scope(codigo text, subm text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT rs.scope_value FROM public.role_scope_settings rs
      JOIN public.submodules sm ON sm.id = rs.submodule_id
      JOIN public.modules m ON m.id = sm.module_id
      WHERE rs.role_codigo = codigo AND sm.key = subm),
    'none');
$$;

-- ---------------------------------------------------------------------------
-- 4) scopes_usuario(): { resource_key: scope } para el frontend (Store)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scopes_usuario(_uid uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  res jsonb;
BEGIN
  SELECT COALESCE(jsonb_object_agg(sm.key, rs.scope_value), '{}'::jsonb)
  INTO res
  FROM public.role_scope_settings rs
  JOIN public.usuario_roles ur ON ur.rol_codigo = rs.role_codigo
  JOIN public.submodules sm ON sm.id = rs.submodule_id
  WHERE ur.usuario_id = _uid;
  RETURN res;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) mis_permisos() (ampliado): ahora también devuelve el alcance por recurso.
--    Mantiene el formato original { clave } para no romper el AuthContext actual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mis_permisos()
RETURNS TABLE (clave text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  -- permisos de todos los roles del usuario (via rol_permisos, que ya sincroniza
  -- las claves normalizadas {module}.{submodule}.{action})
  SELECT DISTINCT rp.permiso_clave AS clave
  FROM public.usuario_roles ur
  JOIN public.rol_permisos rp ON rp.rol = ur.rol_codigo
  WHERE ur.usuario_id = auth.uid()
  UNION
  SELECT up.permiso_clave AS clave
  FROM public.usuario_permisos up
  WHERE up.usuario_id = auth.uid() AND up.efecto = 'grant';
END;
$$;
