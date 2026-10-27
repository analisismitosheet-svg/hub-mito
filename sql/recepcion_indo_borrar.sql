-- ============================================================================
-- Recepción Indo: borrar una línea. SOLO administradores.
--
-- La tabla no tiene permiso de DELETE para authenticated (ni política), así que el
-- único camino es esta función: chequea private.es_admin() y borra por clave.
-- La pantalla (src/pages/RecepcionIndo.tsx) muestra el botón solo al admin, pero la
-- regla real vive acá.
--
-- Aplicado en Supabase (migración recepcion_indo_borrar). Idempotente.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recepcion_indo_borrar(p_clave text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF NOT private.es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar líneas de recepción';
  END IF;
  DELETE FROM public.recepcion_indo WHERE clave = p_clave;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.recepcion_indo_borrar(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_borrar(text) TO authenticated;
