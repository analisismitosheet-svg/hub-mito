-- ============================================================================
-- CAMBIO DE POLÍTICA: TODOS ven y marcan TODO (como el admin).
-- Elimina la restricción de "cada local solo ve lo suyo" en transferencias.
--
-- Después de esto, cualquier usuario que tenga el permiso
-- 'transferencias.view' verá TODOS los items de TODOS los orígenes y podrá
-- marcar cualquiera (igual que el admin).
--
-- Ejecutar en Supabase SQL Editor (todo el bloque, en orden).
-- Última actualización del archivo: mantenida por el equipo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reescribir las policies de transfer_items para NO filtrar por local.
--    SELECT: con permiso view se ve TODO el origen / destino.
--    UPDATE: con permiso view se puede marcar cualquier fila (como admin).
-- ---------------------------------------------------------------------------

-- SELECT total (sin filtrar por origen): admin, import y view -> TODO
DROP POLICY IF EXISTS "transfer_items_select_local" ON public.transfer_items;
CREATE POLICY "transfer_items_select_local" ON public.transfer_items
  FOR SELECT
  USING (
    private.tiene_permiso('transferencias.view')
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

-- UPDATE de cualquier fila (sin filtrar por origen): view -> marcar todo
DROP POLICY IF EXISTS "transfer_items_update_local" ON public.transfer_items;
CREATE POLICY "transfer_items_update_local" ON public.transfer_items
  FOR UPDATE
  USING (
    private.tiene_permiso('transferencias.view')
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

-- ---------------------------------------------------------------------------
-- 2. Asegurar permisos (ya deberían estar, es por idempotencia)
-- ---------------------------------------------------------------------------
GRANT SELECT, UPDATE, INSERT ON public.transfer_items TO authenticated;
