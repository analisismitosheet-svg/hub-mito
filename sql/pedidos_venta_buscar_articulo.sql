-- ============================================================================
-- Pedidos de venta: buscar pedidos por artículo (código o descripción)
--
-- Aplicado en Supabase (migración pedidos_venta_buscar_articulo). Idempotente.
--
-- - Índices de texto (pg_trgm) para que "contiene…" sea rápido sobre los
--   ~330k renglones de pedidos_venta_items.
-- - public.pedidos_venta_por_articulo(q): códigos de los pedidos que tienen
--   un artículo cuyo código o descripción contiene q. Revisa el permiso UNA
--   vez (no por fila, como haría la RLS) y devuelve solo los códigos.
-- ============================================================================

CREATE INDEX IF NOT EXISTS pedidos_venta_items_articulo_trgm
  ON public.pedidos_venta_items USING gin (articulo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pedidos_venta_items_descripcion_trgm
  ON public.pedidos_venta_items USING gin (descripcion gin_trgm_ops);

-- Devuelve un array (una sola fila): con SETOF, la API corta en 1000 filas
DROP FUNCTION IF EXISTS public.pedidos_venta_por_articulo(text);

CREATE FUNCTION public.pedidos_venta_por_articulo(q text)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v text := trim(coalesce(q, ''));
  r text[];
BEGIN
  IF NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Sin permiso para ver pedidos de venta';
  END IF;
  IF length(v) < 3 THEN
    RETURN '{}';
  END IF;
  -- los comodines del usuario se toman como texto
  v := '%' || replace(replace(replace(v, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  SELECT coalesce(array_agg(DISTINCT i.codigo), '{}') INTO r
    FROM public.pedidos_venta_items i
   WHERE i.articulo ILIKE v OR i.descripcion ILIKE v;
  RETURN r;
END;
$$;
