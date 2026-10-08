-- ============================================================================
-- Armado: el ✓ manual suma DE A UNA unidad (no marca la línea entera)
--
-- Aplicado en Supabase (migración armado_marcar_unidad). Idempotente.
--
-- Si piden 2 del mismo artículo/color/talle y hay 1, se toca ✓ una vez y queda
-- 1/2; la que falta pasa a faltante al Finalizar (armado_finalizar). Misma firma
-- que antes, así la pantalla vieja sigue andando.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.armado_marcar_item(p_id uuid, p_linea integer)
RETURNS TABLE (item_linea integer, item_escaneadas integer, item_cantidad integer, item_estado text, item_articulo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acept uuid;
  v_est   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT a.aceptado_por, a.estado INTO v_acept, v_est
    FROM public.mayorista_armados a WHERE a.id = p_id FOR UPDATE;
  IF v_acept IS NULL THEN
    RAISE EXCEPTION 'Ese armado no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_acept <> auth.uid() AND NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Ese armado lo está haciendo otro legajo' USING ERRCODE = '42501';
  END IF;
  IF v_est <> 'aceptado' THEN
    RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.mayorista_armados_items i
     SET escaneadas = i.escaneadas + 1,
         estado = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN 'hecho' ELSE i.estado END
   WHERE i.armado_id = p_id
     AND i.linea = p_linea
     AND i.estado = 'pendiente'
     AND i.escaneadas < i.cantidad
   RETURNING i.linea, i.escaneadas, i.cantidad, i.estado, i.articulo;

  PERFORM private.armado_cerrar_si_listo(p_id);
END;
$$;
