-- =====================================================================
-- Recepción INDO: filtro por mes(es) del año vigente + IVA de lo filtrado
-- (05/11/2026)
--
-- recepcion_indo_filas suma:
--   * p_meses int[]: meses (1-12) del AÑO EN CURSO (hora de Argentina). Vacío o
--     NULL = sin filtro de mes (todos los años). El mes sale de la fecha de
--     ingreso (o la del remito si no tiene ingreso).
--   * iva_filtrado: suma del IVA de TODAS las filas que pasan los filtros (no
--     solo la página), para la tarjeta de IVA.
--
-- Cambia la firma y el RETURNS, así que hay que DROP + CREATE (con CREATE OR
-- REPLACE quedaría una sobrecarga y PostgREST no sabría a cuál llamar).
-- =====================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer);

CREATE FUNCTION public.recepcion_indo_filas(
  p_deposito   text DEFAULT '',
  p_proveedor  text DEFAULT '',
  p_transporte text DEFAULT '',
  p_estado     text DEFAULT '',
  p_control    text DEFAULT '',
  p_busqueda   text DEFAULT '',
  p_desde      integer DEFAULT 0,
  p_limite     integer DEFAULT 200,
  p_meses      integer[] DEFAULT NULL
)
RETURNS TABLE(
  total bigint, clave text, n_guia text, transporte text, bultos integer, deposito text,
  proveedor text, proveedor_codigo text, n_remito text, fecha_remito date, mes integer,
  n_oc text, oc_cargada_dragon boolean, n_factura text, fecha_factura date, factura_link text,
  fecha_ingreso date, fecha_controlada date, dias_atraso integer, estado text, iva numeric,
  detalle text, controlado_at timestamptz, controlado_por text, errores text[],
  iva_filtrado numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  WITH base AS (
    SELECT r.*
    FROM public.recepcion_indo r
    WHERE private.tengo_permiso('deposito.view')
      AND (nullif(btrim(coalesce(p_deposito, '')), '') IS NULL OR r.deposito = btrim(p_deposito))
      AND (nullif(btrim(coalesce(p_proveedor, '')), '') IS NULL OR r.proveedor = btrim(p_proveedor))
      AND (nullif(btrim(coalesce(p_transporte, '')), '') IS NULL OR r.transporte = btrim(p_transporte))
      AND (nullif(btrim(coalesce(p_estado, '')), '') IS NULL OR r.estado = btrim(p_estado))
      AND (
        coalesce(cardinality(p_meses), 0) = 0
        OR (
          extract(year FROM coalesce(r.fecha_ingreso, r.fecha_remito))
            = extract(year FROM (now() AT TIME ZONE 'America/Argentina/Cordoba'))
          AND extract(month FROM coalesce(r.fecha_ingreso, r.fecha_remito))::int = ANY (p_meses)
        )
      )
      AND (
        nullif(btrim(coalesce(p_control, '')), '') IS NULL
        OR (p_control = 'pendientes' AND r.fecha_controlada IS NULL)
        OR (p_control = 'controladas' AND r.fecha_controlada IS NOT NULL)
        OR p_control = 'errores'
        OR (p_control = 'errores_pendientes' AND r.fecha_controlada IS NULL)
      )
      AND (
        nullif(btrim(coalesce(p_busqueda, '')), '') IS NULL
        OR r.n_guia ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.n_remito ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.n_factura ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.n_oc ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.proveedor ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.transporte ILIKE '%' || btrim(p_busqueda) || '%'
        OR coalesce(r.detalle, '') ILIKE '%' || btrim(p_busqueda) || '%'
      )
  ), pv AS MATERIALIZED (
    -- Proveedor fuera del catálogo: una vez por proveedor distinto (~110), no por fila.
    -- Alcanza con que un nombre contenga al otro ("GRIMOLDI S.A." y "GRIMOLDI SA (VANS)").
    SELECT d.proveedor, length(d.c) >= 3 AND NOT EXISTS (
             SELECT 1 FROM public.recepcion_indo_proveedores p
              WHERE p.nombre_compacto = d.c
                 OR (length(d.c) >= 4 AND (strpos(p.nombre_compacto, d.c) > 0
                                           OR (length(p.nombre_compacto) >= 4 AND strpos(d.c, p.nombre_compacto) > 0)))) AS fuera
    FROM (SELECT DISTINCT b.proveedor, private.compacto(b.proveedor) AS c FROM base b) d
  ), f AS (
    SELECT b.*, private.recepcion_indo_errores(b::public.recepcion_indo, coalesce(pv.fuera, false)) AS errs
    FROM base b LEFT JOIN pv ON pv.proveedor IS NOT DISTINCT FROM b.proveedor
  ), pagina AS (
    SELECT f.*, count(*) OVER () AS total, coalesce(sum(f.iva) OVER (), 0) AS iva_tot
    FROM f
    WHERE coalesce(p_control, '') NOT IN ('errores', 'errores_pendientes') OR cardinality(f.errs) > 0
    ORDER BY private.recepcion_indo_orden_estado(f.estado), f.fecha_ingreso DESC NULLS LAST, f.n_guia, f.clave
    LIMIT greatest(1, least(coalesce(p_limite, 200), 1000))
    OFFSET greatest(0, coalesce(p_desde, 0))
  )
  SELECT
    p.total, p.clave, p.n_guia, p.transporte, p.bultos, p.deposito, p.proveedor,
    p.proveedor_codigo, p.n_remito, p.fecha_remito, p.mes, p.n_oc, p.oc_cargada_dragon,
    p.n_factura, p.fecha_factura, p.factura_link, p.fecha_ingreso, p.fecha_controlada,
    p.dias_atraso, p.estado, p.iva, p.detalle, p.controlado_at,
    (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = p.controlado_por),
    p.errs,
    p.iva_tot
  FROM pagina p
$function$;

REVOKE ALL ON FUNCTION public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer, integer[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer, integer[])
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
