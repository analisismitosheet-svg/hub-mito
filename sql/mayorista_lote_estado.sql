-- ============================================================================
-- Repos Mayorista: estado del repo (En proceso / Finalizado)
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
--   NULL          -> todavía nadie marcó ni escaneó nada ("Sin empezar")
--   'en_proceso'  -> se pone SOLO cuando se marca o escanea el primer artículo
--                    (desde Repos Mayorista o desde Mi repo): trigger en items
--   'finalizado'  -> se pone SOLO al llegar al 100% (sin pendientes), o a mano
--                    con public.finalizar_repo_mayorista(lote)
-- ============================================================================

BEGIN;

ALTER TABLE public.mayorista_lotes
  ADD COLUMN IF NOT EXISTS estado text,
  ADD COLUMN IF NOT EXISTS finalizado_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalizado_por uuid;

ALTER TABLE public.mayorista_lotes DROP CONSTRAINT IF EXISTS mayorista_lotes_estado_chk;
ALTER TABLE public.mayorista_lotes
  ADD CONSTRAINT mayorista_lotes_estado_chk CHECK (estado IS NULL OR estado IN ('en_proceso', 'finalizado'));

-- ---- Automático: En proceso con el primer artículo, Finalizado al 100% ----
--   - primer artículo marcado/escaneado            -> 'en_proceso'
--   - no queda ningún artículo pendiente (100%)     -> 'finalizado' (finalizado_por NULL = automático)
--   - un artículo vuelve a pendiente en un repo finalizado AUTOMÁTICAMENTE -> 'en_proceso'
--     (si lo finalizó una persona con el botón, queda finalizado)
CREATE OR REPLACE FUNCTION private.mayorista_lote_en_proceso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quedan boolean;
BEGIN
  IF NOT ((NEW.estado IS DISTINCT FROM OLD.estado)
          OR coalesce(NEW.escaneadas, 0) > coalesce(OLD.escaneadas, 0)) THEN
    RETURN NULL;
  END IF;

  v_quedan := EXISTS (
    SELECT 1 FROM public.mayorista_items
     WHERE lote_id = NEW.lote_id AND estado = 'pendiente'
  );

  IF NOT v_quedan THEN
    UPDATE public.mayorista_lotes
       SET estado = 'finalizado', finalizado_at = now(), finalizado_por = NULL
     WHERE id = NEW.lote_id
       AND estado IS DISTINCT FROM 'finalizado';
  ELSIF NEW.estado = 'pendiente' AND OLD.estado IS DISTINCT FROM 'pendiente' THEN
    UPDATE public.mayorista_lotes
       SET estado = 'en_proceso', finalizado_at = NULL
     WHERE id = NEW.lote_id
       AND estado = 'finalizado'
       AND finalizado_por IS NULL;
  ELSIF NEW.estado <> 'pendiente' OR coalesce(NEW.escaneadas, 0) > coalesce(OLD.escaneadas, 0) THEN
    UPDATE public.mayorista_lotes
       SET estado = 'en_proceso'
     WHERE id = NEW.lote_id
       AND estado IS NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mayorista_lote_en_proceso ON public.mayorista_items;
CREATE TRIGGER trg_mayorista_lote_en_proceso
  AFTER UPDATE OF estado, escaneadas ON public.mayorista_items
  FOR EACH ROW EXECUTE FUNCTION private.mayorista_lote_en_proceso();

-- ---- Finalizar a mano ----
CREATE OR REPLACE FUNCTION public.finalizar_repo_mayorista(p_lote uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin()
          OR private.tiene_permiso('mayorista.import')
          OR private.tiene_permiso('mayorista.mark')) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  UPDATE public.mayorista_lotes
     SET estado = 'finalizado', finalizado_at = now(), finalizado_por = auth.uid()
   WHERE id = p_lote
     AND estado IS DISTINCT FROM 'finalizado';
END;
$$;

-- ---- Repos que ya existían: si ya tienen algo marcado/escaneado, En proceso ----
UPDATE public.mayorista_lotes l
   SET estado = 'en_proceso'
 WHERE l.estado IS NULL
   AND EXISTS (
     SELECT 1 FROM public.mayorista_items i
      WHERE i.lote_id = l.id
        AND (i.estado <> 'pendiente' OR coalesce(i.escaneadas, 0) > 0)
   );

COMMIT;
