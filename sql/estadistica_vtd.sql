-- ============================================================================
-- Estadística VTD (repos): Mayorista → Estadística VTD
--
-- Aplicado en Supabase (migración estadistica_vtd). Idempotente.
--
-- Una fila por repo (mayorista_lotes) y local entre p_desde y p_hasta (por fecha
-- de la repo): venta (lo pedido en la repo), repo (escaneado/tildado en Mi repo),
-- faltante, segundos trabajados con el cronómetro de Mi repo (repo_sesiones, sin
-- pausas; si está en curso suma el tramo actual) y responsable asignado.
-- uni_crono = prendas escaneadas con el cronómetro en marcha (para Prendas/HS).
-- La pantalla arma con esto el día, la semana y el cuadro por local.
-- ============================================================================

DROP FUNCTION IF EXISTS public.estadistica_vtd(date, date);
CREATE FUNCTION public.estadistica_vtd(p_desde date, p_hasta date)
RETURNS TABLE(lote_id uuid, fecha date, venta_fecha date, lote_nombre text, lote_estado text,
              local text, venta integer, repo integer, faltante integer, segundos integer,
              uni_crono integer, responsable text, responsable_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
    RAISE EXCEPTION 'Sin permiso para ver la estadística' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH l AS (
    SELECT * FROM public.mayorista_lotes ml WHERE ml.fecha BETWEEN p_desde AND p_hasta
  ),
  it AS (
    SELECT i.lote_id, upper(btrim(i.local)) AS local,
           sum(i.cantidad)::integer AS venta,
           sum(CASE WHEN i.estado = 'hecho' THEN i.cantidad ELSE least(coalesce(i.escaneadas, 0), i.cantidad) END)::integer AS repo,
           sum(CASE WHEN i.estado = 'faltante' THEN i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad) ELSE 0 END)::integer AS faltante
      FROM public.mayorista_items i JOIN l ON l.id = i.lote_id
     GROUP BY 1, 2
  ),
  se AS (
    SELECT s.lote_id, upper(btrim(s.local)) AS local,
           sum(s.segundos + CASE WHEN s.estado = 'en_curso' AND s.tramo_desde IS NOT NULL
                                 THEN greatest(0, extract(epoch FROM now() - s.tramo_desde)) ELSE 0 END)::integer AS seg,
           sum(s.unidades)::integer AS uni
      FROM public.repo_sesiones s JOIN l ON l.id = s.lote_id
     GROUP BY 1, 2
  ),
  re AS (
    SELECT r.lote_id, upper(btrim(r.local)) AS local, e.nombre::text AS nombre, r.empleado_id
      FROM public.mayorista_responsables r
      JOIN l ON l.id = r.lote_id
      LEFT JOIN public.empleados e ON e.id = r.empleado_id
     WHERE r.empleado_id IS NOT NULL
  )
  SELECT l.id, l.fecha, l.venta_fecha, l.nombre, l.estado,
         it.local, it.venta, it.repo, it.faltante, coalesce(se.seg, 0), coalesce(se.uni, 0), re.nombre, re.empleado_id
    FROM it
    JOIN l ON l.id = it.lote_id
    LEFT JOIN se ON se.lote_id = it.lote_id AND se.local = it.local
    LEFT JOIN re ON re.lote_id = it.lote_id AND re.local = it.local
   ORDER BY l.fecha, it.venta DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.estadistica_vtd(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estadistica_vtd(date, date) TO authenticated;
