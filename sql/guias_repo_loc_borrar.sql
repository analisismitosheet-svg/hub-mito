-- ============================================================
-- Guías REPO LOC: al quedar FINALIZADAS se borran de todos lados.
-- Ejecutar en Supabase SQL Editor. Idempotente. (Ya aplicado en hub-mito.)
--
-- Si la sucursal contiene "REPO LOC" (REM REPO LOC, MITO/REPOLOC, …) y el estado
-- llega a FINALIZADO / FINALIZADO_FACT / FINALIZADO_A_CAJA, se borra:
--   la guía, su copia en facturacion_fabrica y en notas_credito, y todo su historial.
-- No queda registro. (Solo base del hub: los SQL Server de la empresa no se tocan.)
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.es_guia_repo_loc_finalizada(p_sucursal text, p_estado text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT upper(replace(coalesce(p_sucursal, ''), ' ', '')) LIKE '%REPOLOC%'
     AND p_estado IN ('FINALIZADO', 'FINALIZADO_FACT', 'FINALIZADO_A_CAJA')
$$;

CREATE OR REPLACE FUNCTION private.guias_repo_loc_borrar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.historial h
   WHERE h.entidad = 'facturacion'
     AND h.registro_id::text IN (SELECT f.id::text FROM public.facturacion_fabrica f WHERE f.guia_id = NEW.id);
  DELETE FROM public.historial h
   WHERE h.entidad = 'nota_credito'
     AND h.registro_id::text IN (SELECT n.id::text FROM public.notas_credito n WHERE n.guia_id = NEW.id);
  DELETE FROM public.facturacion_fabrica WHERE guia_id = NEW.id;
  DELETE FROM public.notas_credito WHERE guia_id = NEW.id;
  DELETE FROM public.historial WHERE entidad = 'guia' AND registro_id::text = NEW.id::text;
  DELETE FROM public.guias WHERE id = NEW.id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.guias_repo_loc_borrar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guias_repo_loc_borrar ON public.guias;
CREATE TRIGGER guias_repo_loc_borrar
  AFTER INSERT OR UPDATE ON public.guias
  FOR EACH ROW
  WHEN (private.es_guia_repo_loc_finalizada(NEW.sucursal, NEW.estado))
  EXECUTE FUNCTION private.guias_repo_loc_borrar();

-- Después del borrado la app (o una versión vieja en caché) puede intentar copiar la guía
-- a facturación / notas de crédito o anotar historial: si la guía ya no existe, se descarta.
CREATE OR REPLACE FUNCTION private.descartar_si_guia_borrada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.guia_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.guias g WHERE g.id = NEW.guia_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.descartar_si_guia_borrada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facturacion_sin_guia_borrada ON public.facturacion_fabrica;
CREATE TRIGGER facturacion_sin_guia_borrada
  BEFORE INSERT ON public.facturacion_fabrica
  FOR EACH ROW EXECUTE FUNCTION private.descartar_si_guia_borrada();

DROP TRIGGER IF EXISTS notas_credito_sin_guia_borrada ON public.notas_credito;
CREATE TRIGGER notas_credito_sin_guia_borrada
  BEFORE INSERT ON public.notas_credito
  FOR EACH ROW EXECUTE FUNCTION private.descartar_si_guia_borrada();

-- Historial de una guía que ya no existe (creación / modificación): se descarta.
-- Los "borrado" manuales se siguen registrando como siempre.
CREATE OR REPLACE FUNCTION private.historial_sin_guia_borrada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.entidad = 'guia' AND NEW.accion <> 'borrado'
     AND NOT EXISTS (SELECT 1 FROM public.guias g WHERE g.id::text = NEW.registro_id::text) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.historial_sin_guia_borrada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS historial_sin_guia_borrada ON public.historial;
CREATE TRIGGER historial_sin_guia_borrada
  BEFORE INSERT ON public.historial
  FOR EACH ROW EXECUTE FUNCTION private.historial_sin_guia_borrada();

COMMIT;
