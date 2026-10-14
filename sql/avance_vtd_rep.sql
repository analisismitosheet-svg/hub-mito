-- ============================================================================
-- Avance de los pedidos VTD y REP del período (Eficiencia mayorista)
--
-- Aplicado en Supabase (migración avance_vtd_rep). Idempotente.
--
-- Por motivo (VTD venta diaria / REP reposición), pedidos con fecha en el período
-- (sin anulados): cuántos pedidos hay, cuántos están completos, unidades pedidas y
-- unidades ya armadas/mandadas (de pedidos_venta_estado: armado o repo; los
-- cerrados cuentan completos). La pantalla muestra el % = unidades_ok / unidades.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.avance_vtd_rep(p_desde date, p_hasta date)
RETURNS TABLE(motivo text, pedidos integer, completos integer, unidades integer, unidades_ok integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
    RAISE EXCEPTION 'Sin permiso para ver la estadística' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH p AS (
    SELECT pv.codigo, pv.motivo,
           coalesce((SELECT sum(round(i.cantidad)) FROM public.pedidos_venta_items i WHERE i.codigo = pv.codigo), 0)::integer AS uni
      FROM public.pedidos_venta pv
     WHERE pv.motivo IN ('VTD', 'REP') AND pv.fecha BETWEEN p_desde AND p_hasta AND NOT coalesce(pv.anulado, false)
  )
  SELECT p.motivo,
         count(*)::integer,
         count(*) FILTER (WHERE e.estado = 'hecho')::integer,
         sum(p.uni)::integer,
         sum(CASE WHEN e.origen = 'cerrado' THEN p.uni
                  ELSE least(p.uni, coalesce(e.unidades_ok, 0)) END)::integer
    FROM p
    LEFT JOIN public.pedidos_venta_estado e ON e.codigo = p.codigo
   GROUP BY p.motivo;
END;
$$;

REVOKE ALL ON FUNCTION public.avance_vtd_rep(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avance_vtd_rep(date, date) TO authenticated;
