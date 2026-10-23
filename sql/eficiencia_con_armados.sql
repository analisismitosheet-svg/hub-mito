-- ============================================================================
-- Eficiencia mayorista: sumar los ARMADOS (desde el 09/10/2026 la repo diaria
-- VTD se hace como armado del pedido, no como repo subida en Repos Mayorista)
--
-- Aplicado en Supabase (migración eficiencia_con_armados). Idempotente.
--
-- 1) estadistica_vtd: además de las repos (mayorista_lotes), devuelve una "repo"
--    por día con los pedidos VTD de ese día (fecha del pedido; con o sin armado: sin
--    armado cuenta la venta del pedido y 0 mandado): cada
--    pedido = un local (cliente). venta = unidades pedidas, repo = escaneadas,
--    faltante, segundos = cronómetro del armado, responsable = quien lo aceptó.
--    El venta_fecha sale de la observación "REPO DIARIA (dd/mm/aaaa)" si está.
--    inicio/fin = reloj de esa fila (aceptado_at -> hecho_at del armado; en las
--    repos subidas, de la primera a la última sesión del local). Con eso la pantalla
--    arma el "HS total" de la repo: del primer escaneo al último, contando una sola
--    vez a las personas que trabajan en paralelo (no se suman los cronómetros).
--    Si una sesión o un armado quedó abierto y cruzó la medianoche, inicio/fin van
--    en NULL: no estira el reloj de ese día.
-- OJO: la definición vigente de vw_tiempos_piso está en sql/eficiencia_solo_vtd_rep.sql
-- (solo armados de pedidos VTD). Lo de acá quedó viejo.
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
              uni_crono integer, responsable text, responsable_id uuid,
              inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role' OR private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
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
           sum(s.unidades)::integer AS uni,
           min(s.iniciada_at) AS ini,
           max(greatest(coalesce(s.finalizada_at, now()), s.iniciada_at)) AS fin
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
  -- Pedidos VTD del período con su armado más nuevo (si no tiene, cuenta igual: venta sin mandar)
  ar AS (
    SELECT a.id, coalesce(a.estado, 'pendiente') AS estado, coalesce(a.crono_segundos, 0) AS crono_segundos,
           a.crono_estado, a.crono_desde, a.aceptado_nombre, a.aceptado_por,
           a.aceptado_at, a.hecho_at,
           -- Armado que quedó abierto de un día para el otro (se pausó y se retomó al otro
           -- día): no estira el reloj del día, así que no cuenta para inicio/fin.
           (a.aceptado_at IS NOT NULL AND a.hecho_at IS NOT NULL AND
            (a.hecho_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
              <> (a.aceptado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AS quedo_abierto,
           p.cliente, p.fecha AS pfecha, p.observacion,
           coalesce((SELECT sum(round(i.cantidad)) FROM public.pedidos_venta_items i WHERE i.codigo = p.codigo), 0)::integer AS venta_pedido
      FROM public.pedidos_venta p
      LEFT JOIN LATERAL (
        SELECT * FROM public.mayorista_armados x WHERE x.pedido_codigo = p.codigo ORDER BY x.creado_at DESC LIMIT 1
      ) a ON true
     WHERE p.motivo = 'VTD' AND p.fecha BETWEEN p_desde AND p_hasta AND NOT coalesce(p.anulado, false)
       -- sin armado solo desde que la repo diaria se hace como armado (09/10/2026)
       AND (a.id IS NOT NULL OR p.fecha >= DATE '2026-10-09')
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
         it.local, it.venta, it.repo, it.faltante, coalesce(se.seg, 0), coalesce(se.uni, 0), re.nombre, re.empleado_id,
         -- Sesión que quedó abierta y cruzó la medianoche: no estira el reloj del día
         CASE WHEN se.ini IS NULL OR (se.fin AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                                       <> (se.ini AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN NULL ELSE se.ini END,
         CASE WHEN se.ini IS NULL OR (se.fin AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                                       <> (se.ini AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN NULL ELSE se.fin END
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
         coalesce(ai.venta, ar.venta_pedido), coalesce(ai.repo, 0), coalesce(ai.faltante, 0),
         (ar.crono_segundos + CASE WHEN ar.crono_estado = 'en_curso' AND ar.crono_desde IS NOT NULL
                                   THEN greatest(0, extract(epoch FROM now() - ar.crono_desde)) ELSE 0 END)::integer,
         CASE WHEN ar.crono_segundos > 0 OR ar.crono_estado = 'en_curso' THEN coalesce(ai.repo, 0) ELSE 0 END,
         ar.aceptado_nombre::text,
         ar.aceptado_por,
         CASE WHEN ar.id IS NULL OR ar.quedo_abierto THEN NULL ELSE ar.aceptado_at END,
         CASE WHEN ar.id IS NULL OR ar.quedo_abierto THEN NULL ELSE coalesce(ar.hecho_at, now()) END
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
-- El auth.role() = 'service_role' del guard no se toca: api/informe.ts arma el informe de
-- Eficiencia mayorista con la service role key (sin usuario, auth.uid() es NULL). Si se saca,
-- el envío por WhatsApp corta con 42501 "Sin permiso para ver la estadística".
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
