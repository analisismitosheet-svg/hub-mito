-- ============================================================================
-- Facturación fábrica: las líneas de MITO SRL se borran al cargar la fecha de envío
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Razón social "MITO SRL" (con o sin puntos/espacios). Se borra la línea y su
-- historial (private.borrar_facturacion, sql/guias_repo_loc_borrar.sql) cuando:
--   - se le carga la fecha de envío (pasa de vacía a tener fecha), o
--   - se crea ya con fecha de envío.
-- Las que YA tenían fecha antes de este cambio no se tocan (no se dispara si
-- la fecha ya estaba cargada). Solo base del hub: los SQL Server no se tocan.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.facturacion_mito_srl_borrar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF regexp_replace(upper(coalesce(NEW.razon_social, '')), '[^A-Z]', '', 'g') = 'MITOSRL'
     AND coalesce(trim(NEW.fecha_envio), '') <> ''
     AND (TG_OP = 'INSERT' OR coalesce(trim(OLD.fecha_envio), '') = '') THEN
    PERFORM private.borrar_facturacion(ARRAY[NEW.id]);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.facturacion_mito_srl_borrar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facturacion_mito_srl_borrar ON public.facturacion_fabrica;
CREATE TRIGGER facturacion_mito_srl_borrar
  AFTER INSERT OR UPDATE OF fecha_envio ON public.facturacion_fabrica
  FOR EACH ROW EXECUTE FUNCTION private.facturacion_mito_srl_borrar();
