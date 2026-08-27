-- ============================================================================
-- MIGRACIÓN RBAC — 1/2 ESQUEMA + CATÁLOGO NORMALIZADO
--
-- Profesionaliza el sistema de permisos EXISTENTE sin romperlo.
-- La app ya usa:  roles(codigo) · usuario_roles · rol_permisos(rol,permiso_clave)
--                 · usuario_permisos · RPC mi_perfil()/mis_permisos()
--
-- Qué hace esta migración:
--   1) Agrega un CATÁLOGO NORMALIZADO `permission_catalog`
--      (name · resource · action · scope) estándar RBAC, SIN tocar la tabla
--      `permisos` que ya usa la app (evita romper).
--   2) Deduplica la tabla `permisos` (una fila por clave, sin repetidos).
--   3) Agrega columnas `polo` + `created_by` a facturacion_fabrica.
--   4) Función helper `app_rol()` para RLS (lee usuario_roles + usuarios).
--
-- Ejecutar DESPUÉS de `renovar_permisos.sql`. IDEMPOTENTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) CATÁLOGO NORMALIZADO RBAC (resource / action / scope)
--    NO colisiona con `permisos`/`roles` existentes (nombres distintos).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permission_catalog (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource    text NOT NULL,   -- ej: 'facturacion', 'transportes', 'clientes'
  action      text NOT NULL,   -- read | create | update | delete | mark | import
  scope       text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'own')),
  name        text NOT NULL,   -- etiqueta única (para el panel matriz)
  UNIQUE (resource, action, scope)
);

INSERT INTO public.permission_catalog (resource, action, scope, name) VALUES
  -- FACTURACIÓN (Reglas A/B/C)
  ('facturacion', 'read',   'all', 'Ver facturación (todas las filas)'),
  ('facturacion', 'read',   'own', 'Ver facturación (solo propias y POLO52)'),
  ('facturacion', 'create', 'all', 'Crear facturación'),
  ('facturacion', 'update', 'all', 'Editar facturación'),
  ('facturacion', 'delete', 'all', 'Eliminar facturación'),
  -- TRANSPORTES
  ('transportes', 'read',   'all', 'Ver transportes'),
  ('transportes', 'create', 'all', 'Crear transportes'),
  ('transportes', 'update', 'all', 'Editar transportes'),
  ('transportes', 'delete', 'all', 'Eliminar transportes'),
  -- CLIENTES
  ('clientes', 'read',   'all', 'Ver clientes'),
  ('clientes', 'create', 'all', 'Crear clientes'),
  ('clientes', 'update', 'all', 'Editar clientes'),
  ('clientes', 'delete', 'all', 'Eliminar clientes'),
  -- GUÍAS
  ('guias', 'read',   'all', 'Ver guías'),
  ('guias', 'create', 'all', 'Crear guías'),
  ('guias', 'update', 'all', 'Editar guías'),
  ('guias', 'delete', 'all', 'Eliminar guías')
ON CONFLICT (resource, action, scope) DO NOTHING;

-- Mapeo (reporte): mostrar catálogo
-- SELECT resource, action, scope, name FROM public.permission_catalog ORDER BY resource, action;

-- ---------------------------------------------------------------------------
-- 2) DEDUPLICAR tabla `permisos` (una fila por clave)
--    y garantizar unicidad -> elimina las acciones repetidas de la UI.
-- ---------------------------------------------------------------------------
DELETE FROM public.permisos a
USING public.permisos b
WHERE a.id > b.id AND a.clave = b.clave;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permisos_clave_unique' AND conrelid = 'public.permisos'::regclass
  ) THEN
    ALTER TABLE public.permisos ADD CONSTRAINT permisos_clave_unique UNIQUE (clave);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) COLUMNAS polo + created_by en facturacion_fabrica (Reglas A/B)
-- ---------------------------------------------------------------------------
ALTER TABLE public.facturacion_fabrica
  ADD COLUMN IF NOT EXISTS polo      text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: filas actuales marcadas polo52=true -> polo = 'A POLO52'
UPDATE public.facturacion_fabrica
SET polo = 'A POLO52'
WHERE (polo IS NULL OR polo = '')
  AND polo52 IS TRUE;

-- ---------------------------------------------------------------------------
-- 4) FUNCIÓN app_rol(): rol efectivo para RLS
--    Lee usuario_roles (roles múltiples) y cae a usuarios.rol si no hay.
--    Devuelve el rol en forma de lista para que RLS pregunte por membresía.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_roles()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN ARRAY(
    SELECT COALESCE(ur.rol_codigo, u.rol)
    FROM public.usuarios u
    LEFT JOIN public.usuario_roles ur ON ur.usuario_id = u.id
    WHERE u.id = auth.uid()
    UNION
    SELECT u.rol FROM public.usuarios u WHERE u.id = auth.uid()
  );
END;
$$;

-- helper booleano por rol
CREATE OR REPLACE FUNCTION public.app_es_mayorista() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'mayorista' = ANY (public.app_roles()) OR 'administrador' = ANY (public.app_roles());
$$;

CREATE OR REPLACE FUNCTION public.app_es_polo52() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'polo52' = ANY (public.app_roles());
$$;
