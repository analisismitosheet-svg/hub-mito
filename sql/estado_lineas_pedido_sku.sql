-- ============================================================================
-- Pedidos de venta: estado de cada renglón por SKU (no por número de línea)
--
-- OJO: la versión viva ahora está en pedidos_venta_lineas_ok.sql
-- (private.estado_lineas_pedido_base + correcciones del admin, también por SKU).
-- Este archivo queda como historia del arreglo.
--
-- Problema (pedido 10124, cliente 01068, 13/10/2026): CJ264103 salía ROJO en
-- Pedidos de venta aunque en el armado estaba hecho. Causa: el armado guarda la
-- línea del pedido al momento de pedirlo (mayorista_armados_items.linea), pero el
-- puente de Dragonfish re-sincroniza pedidos_venta_items con DELETE + INSERT y la
-- `linea` que manda el puente se renumera. Al dejar de coincidir las líneas, el
-- caso 1 pintaba el renglón equivocado: el pedido líneas 2-5 (CJ264103) leía el
-- estado de las líneas 2-5 del armado, que eran OTROS artículos (y justo ahí había
-- faltantes).
--
-- Fix: el caso armado cruza por SKU (artículo + color + talle) contra los
-- renglones del pedido y devuelve la línea del PEDIDO. El armado ya es de un solo
-- pedido (mayorista_armados.pedido_codigo), así que nunca cruza entre pedidos.
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

  SELECT * INTO v_ped FROM public.pedidos_venta WHERE codigo = p_codigo;
  IF v_ped.codigo IS NULL THEN RETURN; END IF;

  SELECT a.id INTO v_arm FROM public.mayorista_armados a
   WHERE a.pedido_codigo = p_codigo ORDER BY a.creado_at DESC LIMIT 1;
  IF v_arm IS NOT NULL THEN
    -- Por SKU: se agrupa el armado por artículo+color+talle y se cruza contra las
    -- líneas ACTUALES del pedido. Devuelve la línea del pedido.
    RETURN QUERY
    WITH a AS (
      SELECT upper(btrim(ai.articulo)) AS art,
             upper(btrim(coalesce(ai.color, ''))) AS col,
             upper(btrim(coalesce(ai.talle, ''))) AS tal,
             sum(least(coalesce(ai.escaneadas, 0), ai.cantidad)) AS env,
             sum(ai.cantidad) AS cant,
             bool_or(ai.estado = 'faltante') AS hay_faltante,
             bool_and(ai.estado <> 'pendiente') AS cerrado
        FROM public.mayorista_armados_items ai
       WHERE ai.armado_id = v_arm
       GROUP BY 1, 2, 3
    )
    SELECT i.linea,
           least(coalesce(a.env, 0), round(i.cantidad))::integer,
           CASE WHEN a.art IS NULL THEN 'pendiente'
                WHEN a.env >= a.cant THEN 'hecho'
                WHEN a.hay_faltante OR a.cerrado THEN 'faltante'
                ELSE 'pendiente' END
      FROM public.pedidos_venta_items i
      LEFT JOIN a ON a.art = upper(btrim(i.articulo))
                AND a.col = upper(btrim(coalesce(i.color, '')))
                AND a.tal = upper(btrim(coalesce(i.talle, '')))
     WHERE i.codigo = p_codigo;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
    RETURN QUERY
    SELECT i.linea, round(i.cantidad)::integer, 'hecho'::text
      FROM public.pedidos_venta_items i WHERE i.codigo = p_codigo;
    RETURN;
  END IF;

  IF v_ped.motivo IS DISTINCT FROM 'VTD' THEN RETURN; END IF;

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
