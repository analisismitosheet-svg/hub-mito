-- ============================================================================
-- Liberar un "picking previo" para poder hacer un picking nuevo (18/11/2026)
--
-- Las facturas que ya estaban en Recepción INDO el 13/11 quedaron marcadas como
-- "picking previo" (sql/picking_factura_previa.sql) y no se pueden volver a pickear.
-- Algunas entraron ese mismo día y nunca tuvieron picking (ej. 0002-00006336, OC 15276).
-- Esta función saca la marca de esa factura + OC para que se pueda hacer el picking.
--
-- Solo admin o quien tenga picking.view. Aplicado en Supabase. Idempotente.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.liberar_picking_previo(p_clave text, p_numero text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_fact text;
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('picking.view')) THEN
    RAISE EXCEPTION 'Sin permiso para hacer picking';
  END IF;
  SELECT private.factura_clave(proveedor, n_factura) INTO v_fact FROM public.recepcion_indo WHERE clave = p_clave;
  IF v_fact IS NULL THEN
    RAISE EXCEPTION 'Esa recepción no existe o no tiene N° de factura';
  END IF;
  DELETE FROM public.picking_factura_previa WHERE factura_clave = v_fact AND numero = btrim(p_numero);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa factura no tiene picking previo en la OC %', p_numero;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.liberar_picking_previo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liberar_picking_previo(text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
