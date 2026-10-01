-- ============================================================================
-- Repos Mayorista: estado del repo (En proceso / Finalizado)
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
--   NULL          -> todavía nadie marcó ni escaneó nada ("Sin empezar")
--   'en_proceso'  -> se pone SOLO cuando se marca o escanea el primer artículo
--                    (desde Repos Mayorista o desde Mi repo): trigger en items
--   'finalizado'  -> se pone A MANO con public.finalizar_repo_mayorista(lote)
-- ============================================================================

BEGIN;

ALTER TABLE public.mayorista_lotes
  ADD COLUMN IF NOT EXISTS estado text,
  ADD COLUMN IF NOT EXISTS finalizado_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalizado_por uuid;

ALTER TABLE public.mayorista_lotes DROP CONSTRAINT IF EXISTS mayorista_lotes_estado_chk;
ALTER TABLE public.mayorista_lotes
  ADD CONSTRAINT mayorista_lotes_estado_chk CHECK (estado IS NULL OR estado IN ('en_proceso', 'finalizado'));

-- ---- En proceso automático: primer artículo marcado o escaneado ----
CREATE OR REPLACE FUNCTION private.mayorista_lote_en_proceso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado <> 'pendiente')
     OR coalesce(NEW.escaneadas, 0) > coalesce(OLD.escaneadas, 0) THEN
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
