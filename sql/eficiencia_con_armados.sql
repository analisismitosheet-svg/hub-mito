-- ============================================================================
-- Eficiencia mayorista: sumar los ARMADOS (desde el 09/10/2026 la repo diaria
-- VTD se hace como armado del pedido, no como repo subida en Repos Mayorista)
--
-- Aplicado en Supabase (migración eficiencia_con_armados). Idempotente.
--
-- 1) estadistica_vtd: además de las repos (mayorista_lotes), devuelve una "repo"
--    por día con los armados de pedidos VTD de ese día (fecha del pedido): cada
--    pedido = un local (cliente). venta = unidades pedidas, repo = escaneadas,
--    faltante, segundos = cronómetro del armado, responsable = quien lo aceptó.
--    El venta_fecha sale de la observación "REPO DIARIA (dd/mm/aaaa)" si está.
-- 2) vw_tiempos_piso (Tiempo real en piso): suma los armados terminados por
--    empleado y día (cronómetro del armado, unidades escaneadas, faltantes).
-- ============================================================================

-- Empleado de un usuario (para el legajo que aceptó el armado)
CREATE OR REPLACE FUNCTION private.empleado_de_usuario(p_usuario uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id FROM public.usuarios u JOIN public.empleados e ON e.legajo = u.legajo
   WHERE u.id = p_usuario AND u.legajo IS NOT NULL LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION private.empleado_de_usuario(uuid) TO authenticated;

-- ---- 1) estadistica_vtd con armados ----
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
  ),
  -- Armados de pedidos VTD (la repo diaria desde el 09/10): el más nuevo por pedido
  ar AS (
    SELECT DISTINCT ON (a.pedido_codigo) a.*, p.fecha AS pfecha, p.observacion
      FROM public.mayorista_armados a
      JOIN public.pedidos_venta p ON p.codigo = a.pedido_codigo
     WHERE p.motivo = 'VTD' AND p.fecha BETWEEN p_desde AND p_hasta
     ORDER BY a.pedido_codigo, a.creado_at DESC
  ),
  ai AS (
    SELECT x.armado_id,
           sum(x.cantidad)::integer AS venta,
           sum(least(coalesce(x.escaneadas, 0), x.cantidad))::integer AS repo,
           sum(CASE WHEN x.estado = 'faltante' THEN x.cantidad - least(coalesce(x.escaneadas, 0), x.cantidad) ELSE 0 END)::integer AS faltante
      FROM public.mayorista_armados_items x JOIN ar ON ar.id = x.armado_id
     GROUP BY 1
  ),
  dias AS (
    SELECT ar.pfecha, bool_and(ar.estado = 'hecho') AS terminado FROM ar GROUP BY 1
  )
  SELECT l.id, l.fecha, l.venta_fecha, l.nombre, l.estado,
         it.local, it.venta, it.repo, it.faltante, coalesce(se.seg, 0), coalesce(se.uni, 0), re.nombre, re.empleado_id
    FROM it
    JOIN l ON l.id = it.lote_id
    LEFT JOIN se ON se.lote_id = it.lote_id AND se.local = it.local
    LEFT JOIN re ON re.lote_id = it.lote_id AND re.local = it.local
  UNION ALL
  SELECT md5('armados-vtd-' || ar.pfecha::text)::uuid,
         ar.pfecha,
         (SELECT to_date(substring(ar.observacion FROM '(\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY')),
         'Armados VTD ' || to_char(ar.pfecha, 'DD/MM/YYYY'),
         CASE WHEN d.terminado THEN 'finalizado' ELSE 'en_proceso' END,
         upper(btrim(coalesce(ar.cliente, ''))),
         coalesce(ai.venta, 0), coalesce(ai.repo, 0), coalesce(ai.faltante, 0),
         (ar.crono_segundos + CASE WHEN ar.crono_estado = 'en_curso' AND ar.crono_desde IS NOT NULL
                                   THEN greatest(0, extract(epoch FROM now() - ar.crono_desde)) ELSE 0 END)::integer,
         CASE WHEN ar.crono_segundos > 0 OR ar.crono_estado = 'en_curso' THEN coalesce(ai.repo, 0) ELSE 0 END,
         ar.aceptado_nombre::text,
         ar.aceptado_por
    FROM ar
    JOIN dias d ON d.pfecha = ar.pfecha
    LEFT JOIN ai ON ai.armado_id = ar.id
   -- si ese día además hay repo subida para el mismo local, manda la repo
   WHERE NOT EXISTS (
     SELECT 1 FROM l JOIN public.mayorista_items mi ON mi.lote_id = l.id
      WHERE l.fecha = ar.pfecha AND upper(btrim(mi.local)) = upper(btrim(coalesce(ar.cliente, '')))
   )
   ORDER BY 2, 7 DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.estadistica_vtd(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estadistica_vtd(date, date) TO authenticated;

-- ---- 2) Tiempo real en piso: repos + armados terminados ----
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
     WHERE a.estado = 'hecho' AND a.aceptado_por IS NOT NULL
     GROUP BY 1, 2
  ) x
 GROUP BY 1, 2;

REVOKE ALL ON public.vw_tiempos_piso FROM anon;
GRANT SELECT ON public.vw_tiempos_piso TO authenticated;
