-- =====================================================
-- GUÍAS: EN PROCESO QUEDAN BLOQUEADAS  (mayorista > guías)
--
-- Mientras una guía está EN_PROCESO solo se pueden cambiar:
--   nro_remito, bulto y el estado (estado / en_proceso / finalizado).
-- Todo lo demás (pedido, cliente, razón social, tipo, sucursal, fecha,
-- observaciones) se rechaza. Para corregirlo hay que pasarla a otro estado
-- (ej. Nuevo), guardar, editar y volver a ponerla En Proceso.
--
-- Los administradores (private.es_admin) pueden editar todo igual.
--
-- El estado se interpreta igual que en la pantalla (estadoDe en Guias.tsx):
-- un estado desconocido cuenta como EN_PROCESO si no está finalizada.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.guias_bloqueo_en_proceso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text := upper(coalesce(OLD.estado, ''));
BEGIN
  -- Los administradores pueden editar todo
  IF private.es_admin() THEN
    RETURN NEW;
  END IF;

  IF v_estado NOT IN ('NUEVO', 'EN_PROCESO', 'FINALIZADO_FACT', 'FINALIZADO_A_CAJA', 'APLICADA') THEN
    v_estado := CASE WHEN OLD.finalizado THEN 'FINALIZADO_FACT' ELSE 'EN_PROCESO' END;
  END IF;

  IF v_estado = 'EN_PROCESO' AND (
       NEW.nro_pedido   IS DISTINCT FROM OLD.nro_pedido
    OR NEW.nro_cliente  IS DISTINCT FROM OLD.nro_cliente
    OR NEW.razon_social IS DISTINCT FROM OLD.razon_social
    OR NEW.pedido       IS DISTINCT FROM OLD.pedido
    OR NEW.sucursal     IS DISTINCT FROM OLD.sucursal
    OR NEW.fecha        IS DISTINCT FROM OLD.fecha
    OR NEW.observaciones IS DISTINCT FROM OLD.observaciones
    OR NEW.created_at   IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'La guía está En Proceso: solo se pueden cambiar N° remito, bultos y estado'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guias_bloqueo_en_proceso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guias_bloqueo_en_proceso ON public.guias;
CREATE TRIGGER guias_bloqueo_en_proceso
  BEFORE UPDATE ON public.guias
  FOR EACH ROW EXECUTE FUNCTION private.guias_bloqueo_en_proceso();

COMMIT;
