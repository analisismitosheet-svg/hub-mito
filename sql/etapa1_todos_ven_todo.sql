-- ============================================================================
-- ETAPA 1: TODOS ven/marcan TODO (desbloqueo temporal)
-- Cualquier usuario con permiso 'transferencias.view' ve y marca TODO
-- (igual que el admin). Sin filtro por local.
--
-- Ejecutar en Supabase SQL Editor (todo el bloque, en orden).
-- ============================================================================

-- SELECT: view -> TODO (más admin/import/ver_todo)
DROP POLICY IF EXISTS "transfer_items_select_local" ON public.transfer_items;
CREATE POLICY "transfer_items_select_local" ON public.transfer_items
  FOR SELECT
  USING (
    private.tiene_permiso('transferencias.view')
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

-- UPDATE: view -> marcar TODO
DROP POLICY IF EXISTS "transfer_items_update_local" ON public.transfer_items;
CREATE POLICY "transfer_items_update_local" ON public.transfer_items
  FOR UPDATE
  USING (
    private.tiene_permiso('transferencias.view')
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

GRANT SELECT, UPDATE, INSERT ON public.transfer_items TO authenticated;
