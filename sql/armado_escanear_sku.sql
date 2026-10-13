-- ============================================================================
-- Armado: el escaneo matchea por SKU (código + color + talle), igual que el repo
--
-- Aplicar DESPUÉS de mayorista_armados.sql y piso_codigo_barras.sql
-- (pide private.parsear_codigo_barras / private.mismo_color). Idempotente.
--
-- Antes, armado_escanear sumaba solo por código de artículo y tomaba el primer
-- renglón pendiente (ORDER BY linea): con el mismo artículo en varias líneas
-- (ej. dos colores), el verde/rojo de Pedidos de venta quedaba corrido y los
-- faltantes caían en la línea equivocada. Formato del lector:
--   CODIGO!COLOR!TALLE     ej. zh000200!02!xl
--   CODIGO%COLORTALLE      ej. zh000200%02xl
--   CODIGO                 ej. zh000200  (sin color/talle: como antes)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.armado_escanear(p_id uuid, p_codigo text)
RETURNS TABLE (item_linea integer, item_escaneadas integer, item_cantidad integer, item_estado text, item_articulo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cb   record;   -- parsear_codigo_barras -> (codigo, color, talle)
  v_acept uuid;
  v_est   text;
  v_linea integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  v_cb := private.parsear_codigo_barras(p_codigo);
  IF coalesce(v_cb.codigo, '') = '' THEN
    RAISE EXCEPTION 'Código vacío' USING ERRCODE = '22023';
  END IF;

  SELECT a.aceptado_por, a.estado INTO v_acept, v_est
    FROM public.mayorista_armados a WHERE a.id = p_id;
  IF v_acept IS NULL THEN
    RAISE EXCEPTION 'Ese armado no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_acept <> auth.uid() AND NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Ese armado lo está haciendo otro legajo' USING ERRCODE = '42501';
  END IF;
  IF v_est <> 'aceptado' THEN
    RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
  END IF;

  -- Mismo matching que el repo (escanear_codigo): con color/talle en el código de
  -- barra suma al renglón EXACTO; sin ellos, al primer pendiente (como antes).
  SELECT i.linea INTO v_linea
    FROM public.mayorista_armados_items i
   WHERE i.armado_id = p_id
     AND i.estado <> 'faltante'
     AND i.escaneadas < i.cantidad
     AND upper(regexp_replace(coalesce(i.articulo, ''), '\s', '', 'g')) = v_cb.codigo
     AND (v_cb.color IS NULL OR private.mismo_color(i.color, v_cb.color))
     AND (v_cb.talle IS NULL OR upper(btrim(coalesce(i.talle, ''))) = upper(btrim(v_cb.talle)))
   ORDER BY i.linea
   LIMIT 1
   FOR UPDATE;

  IF v_linea IS NULL THEN
    RAISE EXCEPTION '% no está pendiente en este armado', v_cb.codigo
      || CASE WHEN v_cb.color IS NOT NULL THEN ' color ' || v_cb.color ELSE '' END
      || CASE WHEN v_cb.talle IS NOT NULL THEN ' talle ' || v_cb.talle ELSE '' END
      USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.mayorista_armados_items i
     SET escaneadas = least(i.escaneadas + 1, i.cantidad),
         estado = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN 'hecho' ELSE i.estado END
   WHERE i.armado_id = p_id AND i.linea = v_linea
   RETURNING i.linea, i.escaneadas, i.cantidad, i.estado, i.articulo;

  PERFORM private.armado_cerrar_si_listo(p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.armado_escanear(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armado_escanear(uuid, text) TO authenticated;