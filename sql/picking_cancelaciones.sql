-- ============================================================================
-- Picking: lo cancelado de cada artículo de un pedido de compra
--
-- Aplicado en Supabase (migración picking_cancelaciones). Idempotente.
--
-- Cruza las cancelaciones (public.cancelaciones + cancelaciones_items, copia de
-- DWH.dbo.vw_FACT_CANCELADOS) con los pedidos de compra por la misma clave que
-- usa Estado de pedidos: cancelaciones.codigo_pedido = pedidos_compra.codigo,
-- y artículo + color + talle. Picking lo usa para mostrar lo cancelado, marcar
-- solo lo que queda por ingresar y sugerir una OC nueva si entra algo cancelado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.picking_cancelaciones(p_codigos text[])
RETURNS TABLE(codigo text, articulo text, color text, talle text, cancelado numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.codigo_pedido,
         upper(trim(ci.articulo)),
         coalesce(trim(ci.color), ''),
         coalesce(trim(ci.talle), ''),
         sum(coalesce(ci.cantidad, 0))
    FROM public.cancelaciones c
    JOIN public.cancelaciones_items ci ON ci.nro = c.nro
   WHERE c.codigo_pedido = ANY (p_codigos)
     AND private.tengo_permiso('picking.view')
   GROUP BY 1, 2, 3, 4
$$;
