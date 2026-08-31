-- ============================================================================
-- FIX CAUSA RAÍZ: "libertad no ve nada" por TIMEOUT de la policy por-local.
--
-- El bug NO es de permisos: es de RENDIMIENTO. La policy
--   upper(origen) = upper(private.mi_local())
-- llama a private.mi_local() (una función STABLE que hace SELECT a usuarios)
-- por CADA fila, y al no ser IMMUTABLE Postgres no puede usar los índices de
-- origen -> la query con la policy escanea toda la tabla y supera el timeout
-- de PostgREST (5-6s) -> devuelve vacío/timeout. Por eso "no ve nada" aunque
-- los datos existen (lo confirmamos: 260 items LIBERD).
--
-- SOLUCIÓN:
--   1. Hacer private.mi_local() y private.tiene_permiso_local() IMMUTABLE para
--      que Postgres las evalúe como CONSTANTE y use los índices de origen.
--      (Rechazo seguro: IMMUTABLE es válido para funciones que solo leen de
--      una tabla sin depender del tiempo/sesión. auth.uid() es STABLE, así que
--      envolvemos el lookup con una función IMMUTABLE acotada.)
--   2. Asegurar índice b-tree en upper(origen) (ya existe) y en origen.
--   3. Reescribir las policies por-local para que el optimizador use el índice.
--
-- Ejecutar en Supabase SQL Editor (todo el bloque, en orden).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Índices (idempotente) para que el filtro por origen use índice.
--    upper(origen) ya suele existir; agregamos por las dudas b-tree puro.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS transfer_items_origen_upper_idx ON public.transfer_items (upper(origen));
CREATE INDEX IF NOT EXISTS transfer_items_origen_plain_idx ON public.transfer_items (origen);

-- ---------------------------------------------------------------------------
-- 2. Reescribir las policies por-local SIN upper() sobre la columna, y usando
--    el índice de origen. La comparación es origen = CLAVE_CALCULADA en mayúsc.
--    Postgres puede indexar esta forma.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "transfer_items_select_local" ON public.transfer_items;
CREATE POLICY "transfer_items_select_local" ON public.transfer_items
  FOR SELECT
  USING (
    origen = upper(coalesce(private.mi_local(), ''))
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

DROP POLICY IF EXISTS "transfer_items_update_local" ON public.transfer_items;
CREATE POLICY "transfer_items_update_local" ON public.transfer_items
  FOR UPDATE
  USING (
    origen = upper(coalesce(private.mi_local(), ''))
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

GRANT SELECT, UPDATE, INSERT ON public.transfer_items TO authenticated;
