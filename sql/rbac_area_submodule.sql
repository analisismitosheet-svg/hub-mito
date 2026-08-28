-- ============================================================================
-- SISTEMA DE ROLES Y PERMISOS DINÁMICO — ÁREAS POR SUBMÓDULO (MM)
--
-- Cambia el modelo para que un SUBMÓDULO pueda pertenecer a VARIAS ÁREAS y sus
-- ACCIONES + ALCANCE se configuren POR ÁREA:
--
--   * Tabla nueva `submodule_areas`  (submódulo <-> área, N:M)
--   * `permissions`  -> + module_id ; UNIQUE(module_id, submodule_id, action_id)
--                        name = '{area_key}.{submodule_key}.{action_key}'
--   * `role_scope_settings` -> + module_id ; UNIQUE(role_codigo, submodule_id, module_id)
--   * RPC `permisos_tree` -> App → Área → Acciones (+ scope por área)
--   * Triggers regeneran permisos por las áreas de `submodule_areas`
--
-- BACKWARD-COMPATIBLE con `permisos` legacy (clave = nuevo name).
-- Ejecutar en Supabase SQL Editor. IDEMPOTENTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) TABLA submodule_areas  (N:M submódulo <-> área)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submodule_areas (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submodule_id bigint NOT NULL REFERENCES public.submodules(id) ON DELETE CASCADE,
  module_id    bigint NOT NULL REFERENCES public.modules(id)   ON DELETE CASCADE,
  UNIQUE (submodule_id, module_id)
);

-- ---------------------------------------------------------------------------
-- 2) SEED submodule_areas  (según APPS: areaId + areaIds).
--    Clave compuesta (module key, submodule key) para resolver ids.
-- ---------------------------------------------------------------------------
INSERT INTO public.submodule_areas (submodule_id, module_id)
SELECT sm.id, m.id
FROM public.submodules sm
JOIN public.modules m ON true
WHERE (m.key, sm.key) IN (
  ('locales',   'carga_requerimientos'),
  ('locales',   'control_locales'),
  ('deposito',  'control_locales'),
  ('locales',   'control_vidrieras'),
  ('tesoreria', 'cuentas_amigos'),
  ('locales',   'cuentas_amigos'),
  ('locales',   'errores_tarjetas'),
  ('locales',   'manuales'),
  ('locales',   'opiniones'),
  ('locales',   'reposiciones'),
  ('compras',   'reposiciones'),
  ('locales',   'transporte'),
  ('deposito',  'transporte'),
  ('polo52',    'transporte'),
  ('locales',   'archivos'),
  ('mayorista', 'facturacion'),
  ('mayorista', 'transportes'),
  ('mayorista', 'clientes'),
  ('mayorista', 'guias')
)
ON CONFLICT (submodule_id, module_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) permissions -> agregar module_id y regenerar por área.
-- ---------------------------------------------------------------------------
-- 3a) columna module_id (nullable mientras se backfillea)
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS module_id bigint REFERENCES public.modules(id);

-- 3b) backfill: cada permiso hereda el área del submódulo (módulo primario)
UPDATE public.permissions p
SET module_id = sm.module_id
FROM public.submodules sm
WHERE p.submodule_id = sm.id AND p.module_id IS NULL;

-- 3c) generar los permisos faltantes de las áreas ADICIONALES (submodule_areas),
--     con name '{area_key}.{submodule_key}.{action_key}'.
INSERT INTO public.permissions (module_id, submodule_id, action_id, name)
SELECT sa.module_id, sa.submodule_id, a.id,
       mk.key || '.' || sk.key || '.' || a.key
FROM public.submodule_areas sa
JOIN public.submodules sk ON sk.id = sa.submodule_id
JOIN public.modules   mk ON mk.id  = sa.module_id
JOIN public.actions   a  ON true
ON CONFLICT (name) DO NOTHING;

-- 3d) UNIQUE pasa a incluir el área: (module_id, submodule_id, action_id)
ALTER TABLE public.permissions DROP CONSTRAINT IF EXISTS permissions_submodule_id_action_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permissions_module_submodule_action_key'
  ) THEN
    ALTER TABLE public.permissions
      ADD CONSTRAINT permissions_module_submodule_action_key
      UNIQUE (module_id, submodule_id, action_id);
  END IF;
END $$;

-- 3e) NOT NULL tras completar el backfill
ALTER TABLE public.permissions ALTER COLUMN module_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) role_scope_settings -> + module_id (alcance por área)
-- ---------------------------------------------------------------------------
ALTER TABLE public.role_scope_settings ADD COLUMN IF NOT EXISTS module_id bigint REFERENCES public.modules(id);

UPDATE public.role_scope_settings rs
SET module_id = sm.module_id
FROM public.submodules sm
WHERE rs.submodule_id = sm.id AND rs.module_id IS NULL;

ALTER TABLE public.role_scope_settings DROP CONSTRAINT IF EXISTS role_scope_settings_role_codigo_submodule_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_scope_settings_role_submodule_module_key'
  ) THEN
    ALTER TABLE public.role_scope_settings
      ADD CONSTRAINT role_scope_settings_role_submodule_module_key
      UNIQUE (role_codigo, submodule_id, module_id);
  END IF;
END $$;

ALTER TABLE public.role_scope_settings ALTER COLUMN module_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5) TRIGGERS regeneran permisos por CADA área de submodule_areas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_permissions_from_submodule()
RETURNS TRIGGER AS $$
DECLARE
  a RECORD;  area RECORD; mk text; sk text; pname text; mkey text;
BEGIN
  -- áreas donde vive este submódulo
  FOR area IN
    SELECT sa.module_id FROM public.submodule_areas sa WHERE sa.submodule_id = NEW.id
  LOOP
    SELECT key INTO mk FROM public.modules m WHERE m.id = area.module_id;
    SELECT key INTO sk FROM public.submodules s WHERE s.id = NEW.id;
    FOR a IN SELECT id, key, label FROM public.actions LOOP
      pname := mk || '.' || sk || '.' || a.key;
      INSERT INTO public.permissions (module_id, submodule_id, action_id, name)
      VALUES (area.module_id, NEW.id, a.id, pname)
      ON CONFLICT (module_id, submodule_id, action_id) DO NOTHING;
      INSERT INTO public.permisos (clave, modulo, accion, label, orden)
      VALUES (pname, mk, a.key, a.label || ' (' || NEW.name || ')', 1000)
      ON CONFLICT (clave) DO NOTHING;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5b) si se asocia un submódulo con un área nueva (INSERT en submodule_areas),
--     regenerar sus permisos en esa área.
CREATE OR REPLACE FUNCTION public.sync_permissions_from_submodule_area()
RETURNS TRIGGER AS $$
DECLARE
  a RECORD; mk text; sk text; pname text; sname text;
BEGIN
  SELECT key INTO mk FROM public.modules m WHERE m.id = NEW.module_id;
  SELECT key, name INTO sk, sname FROM public.submodules s WHERE s.id = NEW.submodule_id;
  FOR a IN SELECT id, key, label FROM public.actions LOOP
    pname := mk || '.' || sk || '.' || a.key;
    INSERT INTO public.permissions (module_id, submodule_id, action_id, name)
    VALUES (NEW.module_id, NEW.submodule_id, a.id, pname)
    ON CONFLICT (module_id, submodule_id, action_id) DO NOTHING;
    INSERT INTO public.permisos (clave, modulo, accion, label, orden)
    VALUES (pname, mk, a.key, a.label || ' (' || sname || ')', 1000)
    ON CONFLICT (clave) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5c) acción nueva -> permisos en cada (área, submódulo)
CREATE OR REPLACE FUNCTION public.sync_permissions_from_action()
RETURNS TRIGGER AS $$
DECLARE
  s RECORD; mk text; pname text;
BEGIN
  FOR s IN
    SELECT sa.module_id AS mid, sa.submodule_id AS sid, sm.key AS skey, sm.name AS sname
    FROM public.submodule_areas sa
    JOIN public.submodules sm ON sm.id = sa.submodule_id AND sm.is_active
  LOOP
    SELECT key INTO mk FROM public.modules m WHERE m.id = s.mid;
    pname := mk || '.' || s.skey || '.' || NEW.key;
    INSERT INTO public.permissions (module_id, submodule_id, action_id, name)
    VALUES (s.mid, s.sid, NEW.id, pname)
    ON CONFLICT (module_id, submodule_id, action_id) DO NOTHING;
    INSERT INTO public.permisos (clave, modulo, accion, label, orden)
    VALUES (pname, mk, NEW.key, NEW.label, 1000)
    ON CONFLICT (clave) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_submodule_permissions ON public.submodules;
CREATE TRIGGER trg_submodule_permissions
  AFTER INSERT ON public.submodules
  FOR EACH ROW EXECUTE FUNCTION public.sync_permissions_from_submodule();

DROP TRIGGER IF EXISTS trg_submodule_area_permissions ON public.submodule_areas;
CREATE TRIGGER trg_submodule_area_permissions
  AFTER INSERT ON public.submodule_areas
  FOR EACH ROW EXECUTE FUNCTION public.sync_permissions_from_submodule_area();

DROP TRIGGER IF EXISTS trg_action_permissions ON public.actions;
CREATE TRIGGER trg_action_permissions
  AFTER INSERT ON public.actions
  FOR EACH ROW EXECUTE FUNCTION public.sync_permissions_from_action();
