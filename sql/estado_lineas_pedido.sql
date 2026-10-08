-- ============================================================================
-- Pedidos de venta: estado de cada renglón (para pintarlo en verde en el detalle)
--
-- Aplicado en Supabase (migración estado_lineas_pedido). Idempotente.
--
-- Para un pedido devuelve, por línea, cuánto se mandó y su estado:
--   1) si tiene armado (mayorista_armados, el más nuevo): mayorista_armados_items por línea;
--   2) si no y es VTD con repo del día: mayorista_items de esa repo y local, cruzado
--      por artículo + color + talle (verificado 34/34 en el pedido 10070);
--   3) si es VTD cerrado por única vez (pedidos_vtd_cerrados): todo hecho.
-- estado: hecho | faltante | pendiente
-- ============================================================================

CREATE OR REPLACE FUNCTION public.estado_lineas_pedido(p_codigo text)
RETURNS TABLE(linea integer, enviadas integer, estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_arm  uuid;
  v_ped  public.pedidos_venta%ROWTYPE;
  v_lote uuid;
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('pedidos_venta.view')) THEN
    RETURN;
  END IF;

  SELECT a.id INTO v_arm FROM public.mayorista_armados a
   WHERE a.pedido_codigo = p_codigo ORDER BY a.creado_at DESC LIMIT 1;
  IF v_arm IS NOT NULL THEN
    RETURN QUERY
    SELECT ai.linea, least(coalesce(ai.escaneadas, 0), ai.cantidad)::integer, ai.estado::text
      FROM public.mayorista_armados_items ai WHERE ai.armado_id = v_arm;
    RETURN;
  END IF;

  SELECT * INTO v_ped FROM public.pedidos_venta WHERE codigo = p_codigo;
  IF v_ped.codigo IS NULL OR v_ped.motivo IS DISTINCT FROM 'VTD' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
    RETURN QUERY
    SELECT i.linea, round(i.cantidad)::integer, 'hecho'::text
      FROM public.pedidos_venta_items i WHERE i.codigo = p_codigo;
    RETURN;
  END IF;

  SELECT l.id INTO v_lote FROM public.mayorista_lotes l
   WHERE l.fecha = v_ped.fecha
     AND EXISTS (SELECT 1 FROM public.mayorista_items mi WHERE mi.lote_id = l.id AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente)))
   ORDER BY l.created_at DESC LIMIT 1;
  IF v_lote IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH m AS (
    SELECT upper(btrim(mi.codigo)) AS art, upper(btrim(coalesce(mi.color, ''))) AS col, upper(btrim(coalesce(mi.talle, ''))) AS tal,
           sum(mi.cantidad) AS cant,
           sum(CASE WHEN mi.estado = 'hecho' THEN mi.cantidad ELSE least(coalesce(mi.escaneadas, 0), mi.cantidad) END) AS env,
           bool_and(mi.estado <> 'pendiente') AS cerrado
      FROM public.mayorista_items mi
     WHERE mi.lote_id = v_lote AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente))
     GROUP BY 1, 2, 3
  )
  SELECT i.linea,
         least(coalesce(m.env, 0), round(i.cantidad))::integer,
         CASE WHEN m.art IS NULL THEN 'pendiente'
              WHEN m.env >= m.cant THEN 'hecho'
              WHEN m.cerrado THEN 'faltante'
              ELSE 'pendiente' END
    FROM public.pedidos_venta_items i
    LEFT JOIN m ON m.art = upper(btrim(i.articulo)) AND m.col = upper(btrim(coalesce(i.color, ''))) AND m.tal = upper(btrim(coalesce(i.talle, '')))
   WHERE i.codigo = p_codigo;
END;
$$;

REVOKE ALL ON FUNCTION public.estado_lineas_pedido(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_lineas_pedido(text) TO authenticated;
