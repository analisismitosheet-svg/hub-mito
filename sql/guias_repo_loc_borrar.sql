-- ============================================================
-- Guías REPO LOC: se borran de todos lados al terminar su recorrido.
-- Ejecutar en Supabase SQL Editor. Idempotente. (Ya aplicado en hub-mito.)
--
-- Sucursal que contiene "REPO LOC" (REM REPO LOC, MITO/REPOLOC, …):
--   * FINALIZADO_FACT  -> la guía (y su historial) se borra; su copia en
--     facturacion_fabrica queda marcada (borrar_al_enviar) y se borra, con su
--     historial, cuando se carga la FECHA DE ENVÍO.
--   * FINALIZADO / FINALIZADO_A_CAJA -> se borra todo en el momento.
-- Notas de crédito de la guía: se borran siempre. No queda registro.
-- (Solo base del hub: los SQL Server de la empresa no se tocan.)
-- ============================================================

BEGIN;

ALTER TABLE public.facturacion_fabrica ADD COLUMN IF NOT EXISTS borrar_al_enviar boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION private.es_guia_repo_loc_finalizada(p_sucursal text, p_estado text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT upper(replace(coalesce(p_sucursal, ''), ' ', '')) LIKE '%REPOLOC%'
     AND p_estado IN ('FINALIZADO', 'FINALIZADO_FACT', 'FINALIZADO_A_CAJA')
$$;

-- Borra filas de facturación y su historial
CREATE OR REPLACE FUNCTION private.borrar_facturacion(p_ids uuid[])
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.historial WHERE entidad = 'facturacion' AND registro_id::text IN (SELECT unnest(p_ids)::text);
  DELETE FROM public.facturacion_fabrica WHERE id = ANY (p_ids);
$$;
REVOKE ALL ON FUNCTION private.borrar_facturacion(uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guias_repo_loc_borrar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cli record;
BEGIN
  IF NEW.estado = 'FINALIZADO_FACT' THEN
    -- Pasa por facturación: la copia queda hasta que se cargue la fecha de envío
    IF NOT EXISTS (SELECT 1 FROM public.facturacion_fabrica f WHERE f.guia_id = NEW.id) THEN
      SELECT c.transporte, c.obs_facturacion INTO v_cli
        FROM public.clientes c WHERE c.n_cliente = NEW.nro_cliente
        ORDER BY (c.estado = 'ACTIVO') DESC LIMIT 1;
      INSERT INTO public.facturacion_fabrica (guia_id, n_cliente, razon_social, n_remito, bulto, transporte, observaciones)
      VALUES (NEW.id, NEW.nro_cliente, NEW.razon_social, NEW.nro_remito, NEW.bulto, v_cli.transporte,
              concat_ws(' | ', 'Generado desde Guia N° ' || coalesce(NEW.nro_pedido, ''),
                        coalesce(nullif(trim(NEW.observaciones), ''), v_cli.obs_facturacion)));
    END IF;
    UPDATE public.facturacion_fabrica SET borrar_al_enviar = true WHERE guia_id = NEW.id;
    -- Si ya tenía fecha de envío, se va ya
    PERFORM private.borrar_facturacion(ARRAY(
      SELECT f.id FROM public.facturacion_fabrica f WHERE f.guia_id = NEW.id AND coalesce(trim(f.fecha_envio), '') <> ''));
  ELSE
    PERFORM private.borrar_facturacion(ARRAY(SELECT f.id FROM public.facturacion_fabrica f WHERE f.guia_id = NEW.id));
  END IF;

  DELETE FROM public.historial h
   WHERE h.entidad = 'nota_credito'
     AND h.registro_id::text IN (SELECT n.id::text FROM public.notas_credito n WHERE n.guia_id = NEW.id);
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

-- Facturación marcada (venía de una guía REPO LOC): al cargar la fecha de envío se borra
CREATE OR REPLACE FUNCTION private.facturacion_borrar_al_enviar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.borrar_facturacion(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.facturacion_borrar_al_enviar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS facturacion_borrar_al_enviar ON public.facturacion_fabrica;
CREATE TRIGGER facturacion_borrar_al_enviar
  AFTER UPDATE ON public.facturacion_fabrica
  FOR EACH ROW
  WHEN (NEW.borrar_al_enviar AND coalesce(trim(NEW.fecha_envio), '') <> '')
  EXECUTE FUNCTION private.facturacion_borrar_al_enviar();

-- Después de borrada la guía la app (o una versión vieja en caché) puede intentar copiarla
-- a facturación / notas de crédito: si la guía ya no existe, se descarta.
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

-- Historial (creación / modificación) de una guía o facturación que ya no existe: se descarta.
-- Los "borrado" manuales se siguen registrando como siempre.
CREATE OR REPLACE FUNCTION private.historial_sin_guia_borrada()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.accion <> 'borrado' AND (
       (NEW.entidad = 'guia' AND NOT EXISTS (SELECT 1 FROM public.guias g WHERE g.id::text = NEW.registro_id::text))
    OR (NEW.entidad = 'facturacion' AND NOT EXISTS (SELECT 1 FROM public.facturacion_fabrica f WHERE f.id::text = NEW.registro_id::text))
  ) THEN
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
