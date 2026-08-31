-- ============================================================================
-- REVERTIR a: CADA USUARIO SOLO VE LO SUYO (filtro por local origen).
-- Restaura la restricción de "cada local ve únicamente lo que es para su local".
--
-- Reemplaza las policies por-local (que antes dejábamos "ver todo") y las vuelve
-- a filtrar por upper(origen) = upper(private.mi_local()).
--
-- Precedencia explicitada con paréntesis:
--   (tiene view Y origen = mi_local)  -> el local ve/marca solo lo suyo
--   O admin  O import  O ver_todo     -> estos ven/marcan todo
--
-- Ejecutar en Supabase SQL Editor (todo el bloque, en orden).
-- ============================================================================

-- SELECT del local: solo ve filas cuyo ORIGEN es SU local (sumado al SELECT total)
DROP POLICY IF EXISTS "transfer_items_select_local" ON public.transfer_items;
CREATE POLICY "transfer_items_select_local" ON public.transfer_items
  FOR SELECT
  USING (
    ( private.tiene_permiso('transferencias.view')
      AND upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), '')) )
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

-- UPDATE "es mío": el local marca/finaliza SOLO sus propios envíos
DROP POLICY IF EXISTS "transfer_items_update_local" ON public.transfer_items;
CREATE POLICY "transfer_items_update_local" ON public.transfer_items
  FOR UPDATE
  USING (
    ( private.tiene_permiso('transferencias.view')
      AND upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), '')) )
    OR private.es_admin()
    OR private.tiene_permiso('transferencias.import')
    OR private.tiene_permiso('transferencias.ver_todo')
  );

GRANT SELECT, UPDATE, INSERT ON public.transfer_items TO authenticated;
