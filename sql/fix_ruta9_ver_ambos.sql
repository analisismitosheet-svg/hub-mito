-- ---------------------------------------------------------------------------
-- Fix: el usuario "Indonesia Ruta 9" (local RUTA9D2) no ve los bultos cuyo
-- origen figura como "RUTA9D" (le falta el sufijo "2").
--
-- La RLS de transfer_items exige origen = mi_local exacto, así que aunque el
-- front pida ambos origenes, la política bloquea el "RUTA9D".
--
-- Este fix amplía las políticas SELECT y UPDATE del local para que además del
-- local exacto también matchee la variante sin el sufijo "2" final (si existe):
--   RUTA9D2 -> también RUTA9D
-- No afecta a los demás locales (que no terminan en "2").
-- ---------------------------------------------------------------------------

-- SELECT del local: mí local exacto O la variante sin el "2" final
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
    )
  );

GRANT SELECT, UPDATE, INSERT ON public.transfer_items TO authenticated;
