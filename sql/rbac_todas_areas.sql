-- ============================================================================
-- PANEL DE PERMISOS: MOSTRAR TODAS LAS ÁREAS POR APP
--
-- 1) Genera permisos para TODAS las combinaciones (área × submódulo × acción),
--    salvo el módulo 'configuraciones'. Así el panel muestra todas las áreas
--    y permite activar acciones en cualquier área.
-- 2) `permisos_tree` devuelve las 14 áreas para cada submódulo.
-- 3) `sincronizar_submodule_areas()` actualiza `submodule_areas` a partir de los
--    permisos concedidos (regla: un app aparece en el menú de un área si tiene
--    ≥1 permiso concedido ahí). Se llama desde el guardado del panel.
--
-- Ejecutar en Supabase SQL Editor. IDEMPOTENTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) BACKFILL: permisos para todas las (área, submódulo, acción) excepto
--    el módulo 'configuraciones'.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD; a RECORD; mk text; pname text;
BEGIN
  FOR r IN
    SELECT m.id AS mid, sm.id AS sid, sm.key AS skey, sm.name AS sname
    FROM public.modules m
    CROSS JOIN public.submodules sm
    WHERE m.is_active AND sm.is_active AND m.key <> 'configuraciones'
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

-- ---------------------------------------------------------------------------
-- 2) permisos_tree: devuelve TODAS las áreas (módulos visibles) por submódulo.
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
              'asignado', EXISTS (
                SELECT 1 FROM public.submodule_areas sa
                WHERE sa.submodule_id = sm.id AND sa.module_id = m.id),
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
          FROM public.modules m
          WHERE m.is_active AND m.key <> 'configuraciones'
        ), '[]'::jsonb)
      ) AS build
    FROM public.submodules sm
    WHERE sm.is_active
  ) sub
$$;

-- ---------------------------------------------------------------------------
-- 3) sincronizar_submodule_areas(): el menú sigue a los permisos concedidos.
--    Un submódulo queda asignado a los módulos donde ALGÚN rol tiene ≥1 permiso.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_submodule_areas()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.submodule_areas;
  INSERT INTO public.submodule_areas (submodule_id, module_id)
  SELECT DISTINCT p.submodule_id, p.module_id
  FROM public.permissions p
  WHERE EXISTS (
    SELECT 1 FROM public.rol_permisos rp WHERE rp.permiso_clave = p.name
  );
$$;
