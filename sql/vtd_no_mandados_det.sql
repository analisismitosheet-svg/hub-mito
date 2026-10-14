-- ============================================================================
-- Detalle de lo NO MANDADO (Eficiencia mayorista)
--
-- Aplicado en Supabase (migración vtd_no_mandados_det). Idempotente.
--
-- Al tocar el recuadro "No mandados" del bloque Estadística VTD: devuelve una
-- fila por artículo que quedó sin mandar (lo marcado como faltante), con el local,
-- el N° de pedido, el artículo, la descripción, color, talle, lo pedido, lo
-- repuesto y lo no mandado. Igual que el total del recuadro (que sale de
-- estadistica_vtd), cubre las dos fuentes:
--   1) los ARMADOS VTD del período (mayorista_armados_items; el armado más nuevo
--      de cada pedido VTD, que es como se hace la repo diaria desde el 09/10/2026);
--   2) las REPOS SUBIDAS del período (mayorista_items de mayorista_lotes).
-- p_local (opcional) limita a un local, para abrir el detalle de una fila de
-- "Por local".
-- ============================================================================

DROP FUNCTION IF EXISTS public.vtd_no_mandados_det(date, date, text);
CREATE FUNCTION public.vtd_no_mandados_det(p_desde date, p_hasta date, p_local text DEFAULT NULL)
RETURNS TABLE(local text, fecha date, pedido integer, articulo text, descripcion text,
              color text, talle text, cantidad integer, repuesto integer, no_mandado integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
    RAISE EXCEPTION 'Sin permiso para ver la estadística' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ar AS (
    -- El armado más nuevo de cada pedido VTD del período (igual que estadistica_vtd)
    SELECT p.numero, p.fecha, upper(btrim(coalesce(p.cliente, ''))) AS loc, a.id
      FROM public.pedidos_venta p
      LEFT JOIN LATERAL (
        SELECT x.id FROM public.mayorista_armados x WHERE x.pedido_codigo = p.codigo ORDER BY x.creado_at DESC LIMIT 1
      ) a ON true
     WHERE p.motivo = 'VTD' AND p.fecha BETWEEN p_desde AND p_hasta AND NOT coalesce(p.anulado, false)
  )
  SELECT ar.loc, ar.fecha, ar.numero, i.articulo, i.descripcion, i.color, i.talle,
         i.cantidad, least(coalesce(i.escaneadas, 0), i.cantidad),
         i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad)
    FROM ar
    JOIN public.mayorista_armados_items i ON i.armado_id = ar.id
   WHERE i.estado = 'faltante' AND (i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad)) > 0
     AND (p_local IS NULL OR ar.loc = upper(btrim(p_local)))
  UNION ALL
  SELECT upper(btrim(i.local)), l.fecha, NULL, i.articulo, NULL, i.color, i.talle,
         i.cantidad, least(coalesce(i.escaneadas, 0), i.cantidad),
         i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad)
    FROM public.mayorista_lotes l
    JOIN public.mayorista_items i ON i.lote_id = l.id
   WHERE l.fecha BETWEEN p_desde AND p_hasta
     AND i.estado = 'faltante' AND (i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad)) > 0
     AND (p_local IS NULL OR upper(btrim(i.local)) = upper(btrim(p_local)))
   ORDER BY 1, 2, 4, 6, 7;
END;
$$;

REVOKE ALL ON FUNCTION public.vtd_no_mandados_det(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vtd_no_mandados_det(date, date, text) TO authenticated;
