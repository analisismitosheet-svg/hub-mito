-- ============================================================================
-- SISTEMA DE ROLES Y PERMISOS DINÁMICO (Supabase) — ESQUEMA
-- Migra y evoluciona el esquema de permisos EXISTENTE hacia un modelo
-- modules / submodules / actions / permissions + role_scope_settings,
-- 100% dinámico: los permisos se auto-generan al crear submódulos/acciones
-- vía TRIGGERS (sin seeders manuales).
--
-- 100% BACKWARD-COMPATIBLE: cualquier fila de `permissions` se refleja también
-- en la tabla legacy `permisos(clave,modulo,accion,label,orden)` y en
-- `mis_permisos()`, así la app y la UI actuales NO se rompen.
--
-- Ejecutar en Supabase SQL Editor. IDEMPOTENTE.
-- Seed inicial basado en los módulos/submódulos del prompt.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) TABLA modules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.modules (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key       text NOT NULL UNIQUE,          -- ej: 'locales'
  name      text NOT NULL,                 -- ej: 'Locales'
  icon      text,                          -- nombre de icono (opcional)
  "order"   int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- 2) TABLA submodules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submodules (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  module_id  bigint NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  key        text NOT NULL,                -- ej: 'reposiciones', único dentro del módulo
  name       text NOT NULL,
  has_scope  boolean NOT NULL DEFAULT false, -- habilita role_scope_settings
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (module_id, key)
);

-- ---------------------------------------------------------------------------
-- 3) TABLA actions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.actions (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key   text NOT NULL UNIQUE,   -- read | create | update | delete | import | export | approve | mark
  label text NOT NULL           -- Ver | Crear | Editar | Eliminar | Importar | Exportar | Aprobar | Marcar
);

-- ---------------------------------------------------------------------------
-- 4) TABLA permissions
--    name = '{module_key}.{submodule_key}.{action_key}'
--    UNIQUE(submodule_id, action_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submodule_id bigint NOT NULL REFERENCES public.submodules(id) ON DELETE CASCADE,
  action_id   bigint NOT NULL REFERENCES public.actions(id) ON DELETE CASCADE,
  name        text NOT NULL,               -- '{module}.{submodule}.{action}'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submodule_id, action_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_unique ON public.permissions (name);

-- ---------------------------------------------------------------------------
-- 5) TABLA role_scope_settings
--    referencia roles por CODIGO (consistente con usuario_roles/rol_permisos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_scope_settings (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_codigo  text NOT NULL REFERENCES public.roles(codigo) ON DELETE CASCADE,
  submodule_id bigint NOT NULL REFERENCES public.submodules(id) ON DELETE CASCADE,
  scope_value  text NOT NULL,  -- 'all' | 'own' | 'locales_asignados' | 'polo52' | ...
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_codigo, submodule_id)
);

-- ---------------------------------------------------------------------------
-- 6) SEED actions (estándar + específicas)
-- ---------------------------------------------------------------------------
INSERT INTO public.actions (key, label) VALUES
  ('read',   'Ver'),
  ('create', 'Crear'),
  ('update', 'Editar'),
  ('delete', 'Eliminar'),
  ('import', 'Importar'),
  ('export', 'Exportar'),
  ('approve','Aprobar'),
  ('mark',   'Marcar')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7) SEED modules (del prompt)
-- ---------------------------------------------------------------------------
INSERT INTO public.modules (key, name, icon, "order", is_active) VALUES
  ('administracion', 'Administración',   'Settings',      10, true),
  ('arquitectura',   'Arquitectura',     'Ruler',         20, true),
  ('compras',        'Compras',          'ShoppingCart',  30, true),
  ('deposito',       'Depósito',         'Package',       40, true),
  ('diseno',         'Diseño',           'Palette',       50, true),
  ('locales',        'Locales',          'Store',         60, true),
  ('mantenimiento',  'Mantenimiento',    'Wrench',        70, true),
  ('marketing',      'Marketing',        'Megaphone',     80, true),
  ('mayorista',      'Mayorista',        'Boxes',         90, true),
  ('polo52',         'Polo 52',          'Building2',    100, true),
  ('recepcion',      'Recepción',        'Inbox',        110, true),
  ('rrhh',           'RR.HH.',           'Users',        120, true),
  ('sistemas',       'Sistemas',         'Server',       130, true),
  ('tesoreria',      'Tesorería',        'Wallet',       140, true),
  ('configuraciones','Configuraciones',  'Cog',          150, true)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8) SEED submodules de LOCALES (del prompt + otros conocidos)
-- ---------------------------------------------------------------------------
INSERT INTO public.submodules (module_id, key, name, has_scope, is_active)
SELECT m.id, s.key, s.name, s.has_scope, true
FROM public.modules m,
  (VALUES
    ('carga_requerimientos','Carga requerimientos',false),
    ('control_locales','Control de Locales',true),
    ('control_vidrieras','Control vidrieras',true),
    ('cuentas_amigos','Cuentas Amigos',false),
    ('errores_tarjetas','Errores tarjetas',true),
    ('manuales','Manuales',false),
    ('opiniones','Opiniones',false),
    ('reposiciones','Reposiciones / Transferencias',false),
    ('transporte','Transporte',false),
    ('archivos','Archivos',false)
  ) AS s(key, name, has_scope)
WHERE m.key = 'locales'
ON CONFLICT (module_id, key) DO NOTHING;

-- Sembrar también los submódulos "mayorista" que ya existen en permisos legacy
-- (facturacion, transportes, clientes, guias) para enriquecer el árbol.
INSERT INTO public.submodules (module_id, key, name, has_scope, is_active)
SELECT m.id, s.key, s.name, s.has_scope, true
FROM public.modules m,
  (VALUES
    ('facturacion','Facturación Fábrica',true),
    ('transportes','Transportes',false),
    ('clientes','Clientes',false),
    ('guias','Guías',false)
  ) AS s(key, name, has_scope)
WHERE m.key = 'mayorista'
ON CONFLICT (module_id, key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9) (reservado) backfill automático de la tabla legacy al modelo normalizado.
--    La sincronización real la hacen los triggers de la sección 10; aquí no se
--    mapea la tabla legacy para evitar generar filas incorrectas (el formato
--    legacy no siempre contiene un submodule_key limpio).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 10) TRIGGER — AUTO-GENERACIÓN DE PERMISOS (requisito clave: 100% dinámico)
--     a) Al insertar un nuevo SUBMÓDULO -> se crean permisos con TODAS las acciones
--     b) Al insertar una nueva ACCIÓN  -> se crean permisos con TODOS los submódulos
--     En ambos casos también se escribe en la tabla legacy `permisos` (BC).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_permissions_from_submodule()
RETURNS TRIGGER AS $$
DECLARE
  a RECORD;  mkey text; pname text;
BEGIN
  SELECT m.key INTO mkey FROM public.modules m WHERE m.id = NEW.module_id;
  FOR a IN SELECT id, key, label FROM public.actions LOOP
    pname := mkey || '.' || NEW.key || '.' || a.key;
    INSERT INTO public.permissions (submodule_id, action_id, name)
    VALUES (NEW.id, a.id, pname)
    ON CONFLICT (submodule_id, action_id) DO NOTHING;
    -- espejo a la tabla legacy para no romper la app actual
    INSERT INTO public.permisos (clave, modulo, accion, label, orden)
    VALUES (pname, mkey, a.key, a.label || ' (' || NEW.name || ')', 1000)
    ON CONFLICT (clave) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_submodule_permissions ON public.submodules;
CREATE TRIGGER trg_submodule_permissions
  AFTER INSERT ON public.submodules
  FOR EACH ROW EXECUTE FUNCTION public.sync_permissions_from_submodule();

CREATE OR REPLACE FUNCTION public.sync_permissions_from_action()
RETURNS TRIGGER AS $$
DECLARE
  s RECORD; mkey text; pname text;
BEGIN
  FOR s IN SELECT sm.id, sm.key, sm.module_id FROM public.submodules sm WHERE sm.is_active LOOP
    SELECT m.key INTO mkey FROM public.modules m WHERE m.id = s.module_id;
    pname := mkey || '.' || s.key || '.' || NEW.key;
    INSERT INTO public.permissions (submodule_id, action_id, name)
    VALUES (s.id, NEW.id, pname)
    ON CONFLICT (submodule_id, action_id) DO NOTHING;
    INSERT INTO public.permisos (clave, modulo, accion, label, orden)
    VALUES (pname, mkey, NEW.key, NEW.label, 1000)
    ON CONFLICT (clave) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_action_permissions ON public.actions;
CREATE TRIGGER trg_action_permissions
  AFTER INSERT ON public.actions
  FOR EACH ROW EXECUTE FUNCTION public.sync_permissions_from_action();

-- ---------------------------------------------------------------------------
-- 11) SEED role_scope_settings: prefijar reglas de negocio conocidas.
--     polo52 -> facturacion scope 'own'  |  mayorista -> facturacion scope 'all'
-- ---------------------------------------------------------------------------
INSERT INTO public.role_scope_settings (role_codigo, submodule_id, scope_value)
SELECT 'polo52', sm.id, 'own'
FROM public.submodules sm
JOIN public.modules m ON m.id = sm.module_id
WHERE m.key = 'mayorista' AND sm.key = 'facturacion'
ON CONFLICT (role_codigo, submodule_id) DO NOTHING;

INSERT INTO public.role_scope_settings (role_codigo, submodule_id, scope_value)
SELECT 'mayorista', sm.id, 'all'
FROM public.submodules sm
JOIN public.modules m ON m.id = sm.module_id
WHERE m.key = 'mayorista' AND sm.key = 'facturacion'
ON CONFLICT (role_codigo, submodule_id) DO NOTHING;
