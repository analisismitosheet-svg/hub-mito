-- ============================================================================
-- Tiempo real en piso, abierto por motivo del pedido (23/10/2026)
--
-- Aplicado en Supabase (migraciones tiempos_piso_vtd_solo_informe y
-- tiempos_piso_por_motivo). Idempotente. Reemplaza la definición de
-- vw_tiempos_piso que estaba en sql/eficiencia_solo_vtd_rep.sql.
--
-- Dos usos distintos, por eso el motivo va como columna y no como filtro fijo:
--   * La pantalla Eficiencia mayorista muestra TODO lo que hizo cada legajo
--     (cualquier motivo) y filtra en el front con los botones Motivo.
--   * El informe diario por WhatsApp es el de la repo del día: pide
--     vw_tiempos_piso_motivo con motivo = 'VTD'.
--
-- Motivos: VTD (venta diaria) · REP (reposición locales) · OTRO (pedidos sin motivo).
-- Las repos subidas por archivo (repo_sesiones, Mi repo) son la repo diaria → VTD.
-- ============================================================================

-- Sin filtro de motivo: lo que hizo cada legajo, todo junto.
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

-- Lo mismo, abierto por motivo: la usan la pantalla (filtro) y el informe (motivo=VTD).
CREATE OR REPLACE VIEW public.vw_tiempos_piso_motivo
WITH (security_invoker = true) AS
SELECT x.empleado_id, x.fecha, x.motivo,
       sum(x.sesiones)::integer AS sesiones,
       sum(x.repos)::integer AS repos,
       sum(x.unidades)::integer AS unidades,
       sum(x.segundos)::integer AS segundos,
       sum(x.pendientes_fin)::integer AS pendientes_fin
  FROM (
    SELECT s.empleado_id,
           (s.iniciada_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS fecha,
           'VTD'::text AS motivo,
           count(*) AS sesiones,
           count(DISTINCT (s.lote_id, upper(s.local))) AS repos,
           sum(s.unidades) AS unidades,
           sum(s.segundos) AS segundos,
           sum(coalesce(s.pendientes_fin, 0)) AS pendientes_fin
      FROM public.repo_sesiones s
     WHERE s.estado = 'finalizada'
     GROUP BY 1, 2, 3
    UNION ALL
    SELECT private.empleado_de_usuario(a.aceptado_por),
           (coalesce(a.aceptado_at, a.hecho_at) AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
           CASE WHEN p.motivo IN ('VTD', 'REP') THEN p.motivo ELSE 'OTRO' END,
           count(*),
           count(*),
           sum((SELECT sum(least(coalesce(i.escaneadas, 0), i.cantidad)) FROM public.mayorista_armados_items i WHERE i.armado_id = a.id)),
           sum(a.crono_segundos),
           sum(a.faltantes)
      FROM public.mayorista_armados a
      LEFT JOIN public.pedidos_venta p ON p.codigo = a.pedido_codigo
     WHERE a.estado = 'hecho' AND a.aceptado_por IS NOT NULL
     GROUP BY 1, 2, 3
  ) x
 GROUP BY 1, 2, 3;

REVOKE ALL ON public.vw_tiempos_piso FROM anon;
REVOKE ALL ON public.vw_tiempos_piso_motivo FROM anon;
GRANT SELECT ON public.vw_tiempos_piso TO authenticated;
GRANT SELECT ON public.vw_tiempos_piso_motivo TO authenticated;
