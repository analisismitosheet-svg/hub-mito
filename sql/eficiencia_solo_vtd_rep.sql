-- ============================================================================
-- Eficiencia mayorista: solo los empleados que trabajan VTD o REP
--
-- Aplicado en Supabase (migración eficiencia_solo_vtd_rep). Idempotente.
--
-- En las estadísticas tienen que salir los empleados que hacen pedidos con motivo
-- VTD (venta diaria) o REP (reposición), o repos de Repos Mayorista. Quien solo
-- arma otros pedidos (ej. legajo 279) no aparece.
--   * private.usuarios_vtd_rep(desde, hasta): quiénes hicieron VTD/REP en el período.
--   * vw_tiempos_piso: los armados cuentan solo si el pedido es VTD o REP.
--   * estadistica_tiempos_muertos y estadistica_pausas: solo esos usuarios.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.usuarios_vtd_rep(p_desde date, p_hasta date)
RETURNS TABLE(usuario_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.aceptado_por
    FROM public.mayorista_armados a
    JOIN public.pedidos_venta p ON p.codigo = a.pedido_codigo
   WHERE a.aceptado_por IS NOT NULL AND p.motivo IN ('VTD', 'REP')
     AND (coalesce(a.aceptado_at, a.creado_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
  UNION
  SELECT s.usuario_id
    FROM public.repo_sesiones s
   WHERE (s.iniciada_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
$$;

-- ---- Tiempo real en piso: armados solo de pedidos VTD/REP ----
CREATE OR REPLACE VIEW public.vw_tiempos_piso
WITH (security_invoker = true) AS
SELECT x.empleado_id, x.fecha,
       sum(x.sesiones)::integer AS sesiones,
       sum(x.repos)::integer AS repos,
       sum(x.unidades)::integer AS unidades,
       sum(x.segundos)::integer AS segundos,
       sum(x.pendientes_fin)::integer AS pendientes_fin
  FROM (
    SELECT s.empleado_id,
           (s.iniciada_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS fecha,
           count(*) AS sesiones,
           count(DISTINCT (s.lote_id, upper(s.local))) AS repos,
           sum(s.unidades) AS unidades,
           sum(s.segundos) AS segundos,
           sum(coalesce(s.pendientes_fin, 0)) AS pendientes_fin
      FROM public.repo_sesiones s
     WHERE s.estado = 'finalizada'
     GROUP BY 1, 2
    UNION ALL
    SELECT private.empleado_de_usuario(a.aceptado_por),
           (coalesce(a.aceptado_at, a.hecho_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
           count(*),
           count(*),
           sum((SELECT sum(least(coalesce(i.escaneadas, 0), i.cantidad)) FROM public.mayorista_armados_items i WHERE i.armado_id = a.id)),
           sum(a.crono_segundos),
           sum(a.faltantes)
      FROM public.mayorista_armados a
      JOIN public.pedidos_venta p ON p.codigo = a.pedido_codigo
     WHERE a.estado = 'hecho' AND a.aceptado_por IS NOT NULL AND p.motivo IN ('VTD', 'REP')
     GROUP BY 1, 2
  ) x
 GROUP BY 1, 2;

REVOKE ALL ON public.vw_tiempos_piso FROM anon;
GRANT SELECT ON public.vw_tiempos_piso TO authenticated;

-- ---- Pausas: solo quienes hicieron VTD/REP en el período ----
CREATE OR REPLACE FUNCTION public.estadistica_pausas(p_desde date, p_hasta date)
RETURNS TABLE(usuario_id uuid, legajo text, nombre text, motivo text, pausas integer, segundos integer, abiertas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
    RAISE EXCEPTION 'Sin permiso para ver la estadística' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.usuario_id, u.legajo::text, coalesce(nullif(btrim(u.nombre), ''), u.email)::text, p.motivo,
         count(*)::integer,
         sum(extract(epoch FROM coalesce(p.hasta, now()) - p.desde))::integer,
         count(*) FILTER (WHERE p.hasta IS NULL)::integer
    FROM public.piso_pausas p
    LEFT JOIN public.usuarios u ON u.id = p.usuario_id
   WHERE p.estado = 'autorizada'
     AND p.desde IS NOT NULL
     AND (p.desde AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
     AND p.usuario_id IN (SELECT v.usuario_id FROM private.usuarios_vtd_rep(p_desde, p_hasta) v)
   GROUP BY 1, 2, 3, 4;
END; $function$;

-- ---- Tiempo muerto: solo quienes hicieron VTD/REP en el período ----
CREATE OR REPLACE FUNCTION public.estadistica_tiempos_muertos(p_desde date, p_hasta date)
RETURNS TABLE(usuario_id uuid, legajo text, nombre text, cortes integer, muerto integer, promedio integer, maximo integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
    RAISE EXCEPTION 'Sin permiso para ver la estadística' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH eventos AS (
    SELECT a.aceptado_por AS usuario_id, coalesce(a.iniciado_at, a.aceptado_at) AS at, 'inicio'::text AS tipo
      FROM public.mayorista_armados a
     WHERE a.aceptado_por IS NOT NULL AND coalesce(a.iniciado_at, a.aceptado_at) IS NOT NULL
    UNION ALL
    SELECT a.aceptado_por, a.hecho_at, 'fin'
      FROM public.mayorista_armados a
     WHERE a.aceptado_por IS NOT NULL AND a.hecho_at IS NOT NULL
    UNION ALL
    SELECT s.usuario_id, s.iniciada_at, 'inicio'
      FROM public.repo_sesiones s
     WHERE s.iniciada_at IS NOT NULL
    UNION ALL
    SELECT s.usuario_id, s.finalizada_at, 'fin'
      FROM public.repo_sesiones s
     WHERE s.finalizada_at IS NOT NULL
  ),
  con_previo AS (
    SELECT e.usuario_id, e.at, e.tipo,
           lag(e.tipo) OVER w AS previo_tipo,
           lag(e.at)   OVER w AS previo_at
      FROM eventos e
    WINDOW w AS (PARTITION BY e.usuario_id ORDER BY e.at, CASE WHEN e.tipo = 'fin' THEN 0 ELSE 1 END)
  ),
  huecos AS (
    SELECT c.usuario_id, c.at, (c.at - c.previo_at) AS espera
      FROM con_previo c
     WHERE c.tipo = 'inicio'
       AND c.previo_tipo = 'fin'
       AND c.previo_at IS NOT NULL
       AND c.at > c.previo_at
       AND (c.previo_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
           = (c.at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
       AND (c.at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
  )
  SELECT h.usuario_id,
         u.legajo::text,
         coalesce(nullif(btrim(u.nombre), ''), u.email)::text,
         count(*)::integer,
         coalesce(sum(extract(epoch FROM h.espera)), 0)::bigint::integer,
         coalesce(round(avg(extract(epoch FROM h.espera))), 0)::integer,
         coalesce(round(max(extract(epoch FROM h.espera))), 0)::integer
    FROM huecos h
    LEFT JOIN public.usuarios u ON u.id = h.usuario_id
   WHERE h.usuario_id IN (SELECT v.usuario_id FROM private.usuarios_vtd_rep(p_desde, p_hasta) v)
   GROUP BY 1, 2, 3
   ORDER BY 5 DESC;
END;
$function$;
