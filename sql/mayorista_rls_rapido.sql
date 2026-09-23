-- =====================================================
-- MAYORISTA: RLS RÁPIDA (misma lógica, se evalúa una vez por consulta)
--
-- Las políticas llamaban private.tiene_permiso() / es_admin() /
-- mi_empleado_id() POR FILA: el resumen de repos (14 mil ítems) tardaba ~8,5 s.
-- Envolviendo cada llamada en (SELECT ...) Postgres la calcula una sola vez
-- (InitPlan). Recomendación oficial de Supabase. No cambia quién ve qué.
-- =====================================================

BEGIN;

-- ---- mayorista_items ----
ALTER POLICY "mitems_admin" ON public.mayorista_items
  USING ((SELECT private.es_admin()))
  WITH CHECK ((SELECT private.es_admin()));
ALTER POLICY "mitems_import" ON public.mayorista_items
  WITH CHECK ((SELECT private.tiene_permiso('mayorista.import')));
ALTER POLICY "mitems_mark" ON public.mayorista_items
  USING ((SELECT private.es_admin()) OR (SELECT private.tiene_permiso('mayorista.mark')))
  WITH CHECK ((SELECT private.es_admin()) OR (SELECT private.tiene_permiso('mayorista.mark')));
ALTER POLICY "mitems_view" ON public.mayorista_items
  USING ((SELECT private.tiene_permiso('mayorista.view')));
ALTER POLICY "mayorista_items_piso_select" ON public.mayorista_items
  USING (EXISTS (
    SELECT 1 FROM public.mayorista_responsables mr
    WHERE mr.lote_id = mayorista_items.lote_id
      AND upper(coalesce(mr.local, '')) = upper(coalesce(mayorista_items.local, ''))
      AND mr.empleado_id = (SELECT private.mi_empleado_id())
  ));

-- ---- mayorista_lotes ----
ALTER POLICY "mlotes_admin" ON public.mayorista_lotes
  USING ((SELECT private.es_admin()))
  WITH CHECK ((SELECT private.es_admin()));
ALTER POLICY "mlotes_import" ON public.mayorista_lotes
  WITH CHECK ((SELECT private.tiene_permiso('mayorista.import')));
ALTER POLICY "mlotes_view" ON public.mayorista_lotes
  USING ((SELECT private.tiene_permiso('mayorista.view')));
ALTER POLICY "mayorista_lotes_piso" ON public.mayorista_lotes
  USING (EXISTS (
    SELECT 1 FROM public.mayorista_responsables mr
    WHERE mr.lote_id = mayorista_lotes.id
      AND mr.empleado_id = (SELECT private.mi_empleado_id())
  ));

-- ---- mayorista_responsables ----
ALTER POLICY "mresp_view" ON public.mayorista_responsables
  USING ((SELECT private.tiene_permiso('mayorista.view')));
ALTER POLICY "mresp_write" ON public.mayorista_responsables
  USING ((SELECT private.es_admin()) OR (SELECT private.tiene_permiso('mayorista.import')) OR (SELECT private.tiene_permiso('mayorista.mark')))
  WITH CHECK ((SELECT private.es_admin()) OR (SELECT private.tiene_permiso('mayorista.import')) OR (SELECT private.tiene_permiso('mayorista.mark')));
ALTER POLICY "mayorista_responsables_piso" ON public.mayorista_responsables
  USING (empleado_id = (SELECT private.mi_empleado_id()));

COMMIT;
