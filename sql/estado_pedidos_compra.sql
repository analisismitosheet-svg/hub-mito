-- =====================================================
-- ESTADO DE PEDIDOS (Compras → Pedidos): cómo viene el ingreso de cada pedido de compra.
-- Cruza pedidos_compra(_items) (copia de Dragonfish) con lo marcado en el Picking (picking_compra)
-- y lo cancelado (cancelaciones, copia de DWH.dbo.vw_FACT_CANCELADOS). Solo unidades.
-- Solo lectura. Permiso: pedidos_compra.view o picking.view. Idempotente.
-- =====================================================

DROP FUNCTION IF EXISTS public.estado_pedidos_compra();
CREATE FUNCTION public.estado_pedidos_compra()
RETURNS TABLE (codigo text, numero integer, comprobante text, fecha date, proveedor text, proveedor_nombre text,
               observacion text, unidades numeric, recibidas numeric, demas numeric, canceladas numeric,
               renglones integer, renglones_completos integer, ultimo_ingreso timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT i.codigo, upper(trim(i.articulo)) AS articulo, coalesce(trim(i.color), '') AS color,
           coalesce(trim(i.talle), '') AS talle, sum(coalesce(i.cantidad, 0)) AS cantidad
    FROM public.pedidos_compra_items i
    WHERE coalesce(trim(i.articulo), '') <> '' AND upper(trim(i.articulo)) NOT IN ('F')
    GROUP BY 1, 2, 3, 4
  ), r AS (
    SELECT it.*, coalesce(k.recibido, 0) AS recibido, k.actualizado_at
    FROM it
    LEFT JOIN public.picking_compra k
      ON k.codigo = it.codigo AND k.articulo = it.articulo AND k.color = it.color AND k.talle = it.talle
  ), canc AS (
    SELECT c.codigo_pedido AS codigo, sum(coalesce(ci.cantidad, 0)) AS canceladas
    FROM public.cancelaciones c JOIN public.cancelaciones_items ci ON ci.nro = c.nro
    WHERE c.codigo_pedido IS NOT NULL
    GROUP BY 1
  )
  SELECT p.codigo, p.numero, p.descripcion, p.fecha, p.proveedor, p.proveedor_nombre, p.observacion,
         coalesce(sum(r.cantidad), 0),
         coalesce(sum(least(r.recibido, r.cantidad)), 0),
         coalesce(sum(greatest(r.recibido - r.cantidad, 0)), 0),
         coalesce(max(canc.canceladas), 0),
         count(r.articulo)::int,
         count(r.articulo) FILTER (WHERE r.recibido >= r.cantidad)::int,
         max(r.actualizado_at) FILTER (WHERE r.recibido > 0)
  FROM public.pedidos_compra p
  LEFT JOIN r ON r.codigo = p.codigo
  LEFT JOIN canc ON canc.codigo = p.codigo
  WHERE NOT p.anulado
    AND (private.tengo_permiso('pedidos_compra.view') OR private.tengo_permiso('picking.view'))
  GROUP BY p.codigo, p.numero, p.descripcion, p.fecha, p.proveedor, p.proveedor_nombre, p.observacion
$$;
REVOKE ALL ON FUNCTION public.estado_pedidos_compra() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_pedidos_compra() TO authenticated;
