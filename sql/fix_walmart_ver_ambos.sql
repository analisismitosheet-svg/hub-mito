-- ---------------------------------------------------------------------------
-- Fix: el usuario Walmart (local "WALMART") no ve los ítems de transferencia
-- cuyo origen figura como "WALMARTD" (le falta / le sobra la "d" final).
--
-- Igual que el fix_ruta9_ver_ambos (sufijo "2"), se amplían las políticas
-- SELECT y UPDATE del local para matchear la variante con/sin la "d" final:
--   WALMARTD <-> WALMART  (en ambos sentidos)
-- Se cubren también los demás casos del fix previo (sufijo "2").
-- ---------------------------------------------------------------------------

-- SELECT del local: mí local exacto O variante sin "2" final O variante con/sin "d" final
DROP POLICY IF EXISTS "transfer_items_select_local" ON public.transfer_items;
CREATE POLICY "transfer_items_select_local" ON public.transfer_items
  FOR SELECT
  USING (
    private.tiene_permiso('transferencias.view')
    AND (
      upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), ''))
      OR (
        right(coalesce(private.mi_local(), ''), 1) = '2'
        AND upper(coalesce(origen, '')) = upper(left(coalesce(private.mi_local(), ''), greatest(length(coalesce(private.mi_local(), '')) - 1, 0)))
      )
      OR (
        right(coalesce(private.mi_local(), ''), 1) = 'D'
        AND upper(coalesce(origen, '')) = upper(left(coalesce(private.mi_local(), ''), greatest(length(coalesce(private.mi_local(), '')) - 1, 0)))
      )
      OR (
        right(coalesce(private.mi_local(), ''), 1) <> 'D'
        AND upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), '') || 'D')
      )
    )
  );

-- UPDATE "es mío": mismo criterio ampliado
DROP POLICY IF EXISTS "transfer_items_update_local" ON public.transfer_items;
CREATE POLICY "transfer_items_update_local" ON public.transfer_items
  FOR UPDATE
  USING (
    private.tiene_permiso('transferencias.view')
    AND (
      upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), ''))
      OR (
        right(coalesce(private.mi_local(), ''), 1) = '2'
        AND upper(coalesce(origen, '')) = upper(left(coalesce(private.mi_local(), ''), greatest(length(coalesce(private.mi_local(), '')) - 1, 0)))
      )
      OR (
        right(coalesce(private.mi_local(), ''), 1) = 'D'
        AND upper(coalesce(origen, '')) = upper(left(coalesce(private.mi_local(), ''), greatest(length(coalesce(private.mi_local(), '')) - 1, 0)))
      )
      OR (
        right(coalesce(private.mi_local(), ''), 1) <> 'D'
        AND upper(coalesce(origen, '')) = upper(coalesce(private.mi_local(), '') || 'D')
      )
    )
  );

GRANT SELECT, UPDATE, INSERT ON public.transfer_items TO authenticated;
