-- ============================================================================
-- SISTEMA DE ROLES Y PERMISOS DINÁMICO (Supabase) — RPCs
--   * permisos_role(codigo)            -> lista plana de permisos del rol
--   * permisos_tree(codigo)            -> árbol App → Área → Acciones (+scope por área)
--   * get_scope(codigo, subm, area)    -> scope_value por (rol, submódulo, área)
--   * scopes_usuario()                 -> { 'area.submodule': scope } del usuario
--   * mis_permisos()                   -> permisos del usuario logueado
--
-- La lógica "backend" pedida (can/applyScope) vive en RLS + estos RPC.
-- Ejecutar DESPUÉS de rbac_dinamico_schema.sql y rbac_area_submodule.sql.
-- IDEMPOTENTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) permisos del ROL (plano): 'compras.reposiciones.read', ...
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.permisos_role(codigo text)
RETURNS TABLE (permiso text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CAST(p.name AS text) AS permiso
  FROM public.permissions p
  JOIN public.rol_permisos rp ON rp.permiso_clave = p.name
  WHERE rp.rol = codigo
  UNION
  SELECT permiso_clave FROM public.rol_permisos WHERE rol = codigo
  ORDER BY 1;
$$;

-- ---------------------------------------------------------------------------
-- 2) ÁRBOL DE PERMISOS para el panel admin (App → Área → Acciones).
--    Estructura JSON:
--    [{ id,key,name,has_scope, areas:[
--         { id,key,name, scope,
--           actions:[ {key,label, has:bool} ] } ] }]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.permisos_tree(codigo text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(build ORDER BY sname), '[]'::jsonb)
  FROM (
    SELECT
      lower(sm.name) AS sname,
      jsonb_build_object(
        'id', sm.id,
        'key', sm.key,
        'name', sm.name,
        'has_scope', sm.has_scope,
        'areas', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'key', m.key,
              'name', m.name,
              'scope', COALESCE(
                (SELECT rs.scope_value FROM public.role_scope_settings rs
                  WHERE rs.role_codigo = codigo
                    AND rs.submodule_id = sm.id
                    AND rs.module_id = m.id), 'none'),
              'actions', COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'key', a.key,
                    'label', a.label,
                    'has', EXISTS (
                      SELECT 1 FROM public.rol_permisos rp
                      WHERE rp.rol = codigo AND rp.permiso_clave = p.name
                    )
                  ) ORDER BY a.id
                )
                FROM public.permissions p
                JOIN public.actions a ON a.id = p.action_id
                WHERE p.submodule_id = sm.id AND p.module_id = m.id
              ), '[]'::jsonb)
            ) ORDER BY m."order"
          )
          FROM public.submodule_areas sa
          JOIN public.modules m ON m.id = sa.module_id
          WHERE sa.submodule_id = sm.id
        ), '[]'::jsonb)
      ) AS build
    FROM public.submodules sm
    WHERE sm.is_active
  ) sub
$$;

-- ---------------------------------------------------------------------------
-- 3) get_scope: alcance configurado para un rol + submódulo + área
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_scope(codigo text, subm text, area text DEFAULT null)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(rs.scope_value, 'none')
  FROM public.role_scope_settings rs
  JOIN public.submodules sm ON sm.id = rs.submodule_id
  JOIN public.modules m     ON m.id  = rs.module_id
  WHERE rs.role_codigo = codigo
    AND sm.key = subm
    AND (area IS NULL OR m.key = area);
$$;

-- ---------------------------------------------------------------------------
-- 4) scopes_usuario(): { 'area.submodule': scope } del usuario
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
  SELECT COALESCE(jsonb_object_agg(m.key || '.' || sm.key, rs.scope_value), '{}'::jsonb)
  INTO res
  FROM public.role_scope_settings rs
  JOIN public.usuario_roles ur ON ur.rol_codigo = rs.role_codigo
  JOIN public.submodules sm ON sm.id = rs.submodule_id
  JOIN public.modules m     ON m.id  = rs.module_id
  WHERE ur.usuario_id = _uid;
  RETURN res;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) mis_permisos() (ampliado): permisos del usuario logueado.
--    Mantiene el formato { clave } para no romper el AuthContext actual.
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

-- ---------------------------------------------------------------------------
-- 6) BACKFILL: regenera `permissions`/`permisos` para TODAS las (área, submódulo).
--    IDEMPOTENTE. Correr después del schema + rbac_area_submodule.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD; a RECORD; mk text; pname text;
BEGIN
  FOR r IN
    SELECT sa.module_id AS mid, sm.id AS sid, sm.key AS skey, sm.name AS sname
    FROM public.submodule_areas sa
    JOIN public.submodules sm ON sm.id = sa.submodule_id AND sm.is_active
  LOOP
    SELECT key INTO mk FROM public.modules m WHERE m.id = r.mid;
    FOR a IN SELECT id, key, label FROM public.actions LOOP
      pname := mk || '.' || r.skey || '.' || a.key;
      INSERT INTO public.permissions (module_id, submodule_id, action_id, name)
      VALUES (r.mid, r.sid, a.id, pname)
      ON CONFLICT (module_id, submodule_id, action_id) DO NOTHING;
      INSERT INTO public.permisos (clave, modulo, accion, label, orden)
      VALUES (pname, mk, a.key, a.label || ' (' || r.sname || ')', 1000)
      ON CONFLICT (clave) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;
