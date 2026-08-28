-- ============================================================================
-- FIX DEFINITIVO: Visibilidad de transferencias por local + permisos (H1/M3/M4)
-- Ejecutar en Supabase SQL Editor (todo el bloque, en orden).
--
-- Objetivos:
--   1. Garantizar que existan las funciones private.mi_local / tiene_permiso /
--      es_admin (el fix previo dependía de ellas pero no estaban versionadas,
--      y si faltan, la policy "local" queda rota -> "no veo nada").
--   2. Recrear LIMPIAS todas las policies de transfer_items (SELECT local/full
--      y UPDATE "es mío"), sin duplicados ni policies viejas en conflicto.
--   3. Índices de rendimiento sobre origen/destino/lote.
--   4. Endurecer las RPC de roles (set_usuario_roles / usuario_roles_usuario)
--      para que solo un administrador real pueda usarlas.
--   5. Bloque de DIAGNÓSTICO que confirma cuántas filas ve cada perfil.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Funciones helpers en schema private (idempotente)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

-- es_admin(): ¿el usuario autenticado es administrador?
-- (DROP previo: CREATE OR REPLACE no puede renombrar parámetros de funciones
--  existentes, y puede haber una versión previa con distinto nombre.)
DROP FUNCTION IF EXISTS private.es_admin();
CREATE OR REPLACE FUNCTION private.es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND (u.es_admin = true OR u.rol = 'administrador'
           OR EXISTS (SELECT 1 FROM public.usuario_roles ur
                      JOIN public.roles r ON r.codigo = ur.rol_codigo
                      WHERE ur.usuario_id = u.id AND r.es_admin = true))
  );
$$;

-- mi_local(): local (código) del usuario autenticado
DROP FUNCTION IF EXISTS private.mi_local();
CREATE OR REPLACE FUNCTION private.mi_local()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.local FROM public.usuarios u WHERE u.id = auth.uid();
$$;

-- tiene_permiso(clave): ¿el usuario autenticado tiene el permiso?
DROP FUNCTION IF EXISTS private.tiene_permiso(text);
CREATE OR REPLACE FUNCTION private.tiene_permiso(permiso_clave text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- permisos de todos los roles del usuario
    SELECT 1
    FROM public.usuario_roles ur
    JOIN public.rol_permisos rp ON rp.rol = ur.rol_codigo
    WHERE ur.usuario_id = auth.uid()
      AND rp.permiso_clave = permiso_clave
    UNION ALL
    -- overrides grant directos
    SELECT 1
    FROM public.usuario_permisos up
    WHERE up.usuario_id = auth.uid()
      AND up.permiso_clave = permiso_clave
      AND up.efecto = 'grant'
  )
  OR private.es_admin();
$$;

-- ---------------------------------------------------------------------------
-- 1. Índices de rendimiento (idempotente)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS transfer_items_lote_id_upper_idx
  ON public.transfer_items (lote_id, upper(origen));
CREATE INDEX IF NOT EXISTS transfer_items_lote_id_idx
  ON public.transfer_items (lote_id);
CREATE INDEX IF NOT EXISTS transfer_items_lote_orden_idx
  ON public.transfer_items (lote_id, orden);
CREATE INDEX IF NOT EXISTS transfer_items_origen_idx
  ON public.transfer_items (upper(origen));
CREATE INDEX IF NOT EXISTS transfer_items_destino_idx
  ON public.transfer_items (upper(destino));

-- ---------------------------------------------------------------------------
-- 2. Limpiar TODAS las policies de transfer_items (evita duplicados/conflicto)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "titems_view"              ON public.transfer_items;
DROP POLICY IF EXISTS "titems_view_full"         ON public.transfer_items;
DROP POLICY IF EXISTS "titems_view_local"        ON public.transfer_items;
DROP POLICY IF EXISTS "titems_update"            ON public.transfer_items;
DROP POLICY IF EXISTS "titems_update_full"       ON public.transfer_items;
DROP POLICY IF EXISTS "titems_update_local"      ON public.transfer_items;
DROP POLICY IF EXISTS "titems_insert"            ON public.transfer_items;
DROP POLICY IF EXISTS "titems_insert_full"       ON public.transfer_items;

-- Habilitar RLS (idempotente)
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Policies SELECT
-- ---------------------------------------------------------------------------

-- 3a. SELECT total: admin, importadores y quienes ven todas las transferencias
DROP POLICY IF EXISTS "transfer_items_select_full" ON public.transfer_items;
CREATE POLICY "transfer_items_select_full" ON public.transfer_items
  FOR SELECT
  USING (
    private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

-- 3b. SELECT del local: ve las filas cuyo ORIGEN es SU local
--     (el local marca lo que él envía). PERMISSIVE -> se suma a la anterior.
DROP POLICY IF EXISTS "transfer_items_select_local" ON public.transfer_items;
CREATE POLICY "transfer_items_select_local" ON public.transfer_items
  FOR SELECT
  USING (
    private.tiene_permiso('transferencias.view')
    AND upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), ''))
  );

-- ---------------------------------------------------------------------------
-- 4. Policies UPDATE (M3: solo "es mío", y admin todo)
-- ---------------------------------------------------------------------------

-- 4a. UPDATE total: administradores / importadores pueden marcar cualquier fila
DROP POLICY IF EXISTS "transfer_items_update_full" ON public.transfer_items;
CREATE POLICY "transfer_items_update_full" ON public.transfer_items
  FOR UPDATE
  USING (
    private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

-- 4b. UPDATE "es mío": el local puede marcar/finalizar SOLO sus propios envíos
DROP POLICY IF EXISTS "transfer_items_update_local" ON public.transfer_items;
CREATE POLICY "transfer_items_update_local" ON public.transfer_items
  FOR UPDATE
  USING (
    private.tiene_permiso('transferencias.view')
    AND upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), ''))
  );

-- 4c. INSERT: solo importadores/admin (nadie más debería crear filas)
DROP POLICY IF EXISTS "transfer_items_insert_full" ON public.transfer_items;
CREATE POLICY "transfer_items_insert_full" ON public.transfer_items
  FOR INSERT
  WITH CHECK (
    private.es_admin()
    OR private.tiene_permiso('transferencias.import')
  );

-- Accordingly, permissions from public:
GRANT SELECT, UPDATE, INSERT ON public.transfer_items TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. (H1) Endurecer RPC de roles: SOLO un administrador real puede usarlas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_usuario_roles(uid uuid, roles_codes text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.es_admin() THEN
    RAISE EXCEPTION 'No autorizado: se requiere ser administrador';
  END IF;

  DELETE FROM public.usuario_roles WHERE usuario_id = uid;
  INSERT INTO public.usuario_roles (usuario_id, rol_codigo)
  SELECT uid, unnest(roles_codes)
  WHERE roles_codes IS NOT NULL AND array_length(roles_codes, 1) > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.usuario_roles_usuario(uid uuid)
RETURNS TABLE (rol_codigo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.es_admin() AND uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No autorizado: se requiere ser administrador';
  END IF;

  RETURN QUERY
  SELECT ur.rol_codigo
  FROM public.usuario_roles ur
  WHERE ur.usuario_id = uid
  ORDER BY ur.rol_codigo;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. DIAGNÓSTICO — corre esto y revisá los números. Deberían cuadrar.
--    (Ejecutá con tu sesión de admin en el SQL Editor.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_total int;
  v_local_txt text;
  v_permiso_view boolean;
BEGIN
  SELECT count(*) INTO v_total FROM public.transfer_items;
  SELECT private.mi_local() INTO v_local_txt;
  v_permiso_view := private.tiene_permiso('transferencias.view');

  RAISE NOTICE '======================== DIAGNOSTICO ========================' ;
  RAISE NOTICE 'mi_local()                     = %', v_local_txt;
  RAISE NOTICE 'tiene_permiso(view)            = %', v_permiso_view;
  RAISE NOTICE 'total items en transfer_items  = %', v_total;
  IF v_local_txt IS NOT NULL AND v_local_txt <> '' THEN
    RAISE NOTICE 'items con origen = %       = %',
      v_local_txt,
      (SELECT count(*) FROM public.transfer_items WHERE upper(origen) = upper(v_local_txt));
  END IF;
  RAISE NOTICE '=============================================================' ;
END;
$$;
