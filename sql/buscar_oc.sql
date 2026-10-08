-- ============================================================================
-- Buscador de N° OC (Recepción INDO: tabla y "Nuevo registro")
--
-- Aplicado en Supabase (migración buscar_oc). Idempotente.
--
-- buscar_oc(p_texto)          una sola llamada: cada palabra tiene que coincidir con
--                             el N°, el proveedor o algún artículo de la OC (código o
--                             descripción del maestro). Devuelve un puntaje para ordenar
--                             (N° exacto > N° que empieza igual > proveedor > artículo)
--                             y los artículos que coincidieron.
-- pedidos_compra_oc_avance()  pedido / recibido (picking) / cancelado de cada OC, para
--                             mostrar Pendiente · Parcial · Completa en el buscador.
-- Mismo permiso que la lista de OC: deposito.view o pedidos_compra.view.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS articulos_descripcion_trgm ON public.articulos USING gin (descripcion gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pedidos_compra_items_articulo_trgm ON public.pedidos_compra_items USING gin (articulo gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.buscar_oc(p_texto text)
RETURNS TABLE(codigo text, puntaje integer, arts jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pal text[];
BEGIN
  IF NOT (private.tengo_permiso('deposito.view') OR private.tengo_permiso('pedidos_compra.view')) THEN
    RETURN;
  END IF;
  -- Palabras en mayúsculas y sin tildes
  SELECT array_agg(DISTINCT w) INTO v_pal
    FROM regexp_split_to_table(
           translate(upper(coalesce(p_texto, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '[^A-Z0-9]+') w
   WHERE w <> '';
  IF v_pal IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH pal AS (
    SELECT w, ord FROM unnest(v_pal) WITH ORDINALITY AS t(w, ord)
  ),
  -- Ítems de OC que coinciden con alguna palabra (código o descripción del maestro)
  it AS (
    SELECT DISTINCT i.codigo, i.articulo, a.descripcion, p.ord
      FROM pal p
      JOIN public.pedidos_compra_items i ON true
      LEFT JOIN public.articulos a ON a.id_art = i.articulo
     WHERE length(p.w) >= 2
       AND (i.articulo ILIKE '%' || p.w || '%'
            OR translate(upper(coalesce(a.descripcion, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') LIKE '%' || p.w || '%')
  ),
  -- Puntaje de cada OC por cada palabra (0 = esa palabra no coincide con nada)
  pp AS (
    SELECT o.codigo, p.ord,
           greatest(
             CASE WHEN o.numero::text = p.w THEN 1000
                  WHEN p.w ~ '^\d+$' AND o.numero::text LIKE p.w || '%' THEN 500 - length(o.numero::text)
                  WHEN p.w ~ '^\d+$' AND o.numero::text LIKE '%' || p.w || '%' THEN 100
                  ELSE 0 END,
             CASE WHEN translate(upper(coalesce(o.proveedor_nombre, '') || ' ' || coalesce(o.proveedor, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')
                       LIKE '%' || p.w || '%' THEN 80 ELSE 0 END,
             CASE WHEN EXISTS (SELECT 1 FROM it WHERE it.codigo = o.codigo AND it.ord = p.ord) THEN 40 ELSE 0 END
           ) AS pts
      FROM public.pedidos_compra_oc o
      CROSS JOIN pal p
     WHERE o.numero IS NOT NULL
  )
  SELECT pp.codigo,
         sum(pp.pts)::integer,
         coalesce((SELECT jsonb_agg(x ORDER BY x->>'articulo')
                     FROM (SELECT DISTINCT jsonb_build_object('articulo', it.articulo, 'descripcion', it.descripcion) AS x
                             FROM it WHERE it.codigo = pp.codigo LIMIT 6) s), '[]'::jsonb)
    FROM pp
   GROUP BY pp.codigo
  HAVING min(pp.pts) > 0
   ORDER BY 2 DESC
   LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.pedidos_compra_oc_avance()
RETURNS TABLE(codigo text, pedido numeric, recibido numeric, cancelado numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ped AS (SELECT i.codigo, sum(i.cantidad) q FROM public.pedidos_compra_items i GROUP BY 1),
       rec AS (SELECT k.codigo, sum(k.recibido) q FROM public.picking_compra k GROUP BY 1),
       can AS (SELECT c.codigo_pedido AS codigo, sum(coalesce(ci.cantidad, 0)) q
                 FROM public.cancelaciones c JOIN public.cancelaciones_items ci ON ci.nro = c.nro
                WHERE c.codigo_pedido IS NOT NULL GROUP BY 1)
  SELECT ped.codigo, ped.q, coalesce(rec.q, 0), coalesce(can.q, 0)
    FROM ped
    LEFT JOIN rec ON rec.codigo = ped.codigo
    LEFT JOIN can ON can.codigo = ped.codigo
   WHERE private.tengo_permiso('deposito.view') OR private.tengo_permiso('pedidos_compra.view')
$$;

REVOKE ALL ON FUNCTION public.buscar_oc(text) FROM anon;
REVOKE ALL ON FUNCTION public.pedidos_compra_oc_avance() FROM anon;
GRANT EXECUTE ON FUNCTION public.buscar_oc(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedidos_compra_oc_avance() TO authenticated;
