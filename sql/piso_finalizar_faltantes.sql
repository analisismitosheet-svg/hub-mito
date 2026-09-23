-- =====================================================
-- FINALIZAR REPO: LO NO ESCANEADO QUEDA COMO FALTANTE  (sigue a piso_codigo_barras.sql)
--
-- Antes, al finalizar solo quedaban marcados los ítems escaneados y el resto
-- seguía "pendiente". Ahora los ítems pendientes de ese (lote, local) pasan a
-- 'faltante' (la ✕ de Mayorista), igual que cuando se marcan a mano:
-- hecho_at = ahora, hecho_por = quien finaliza. Si un ítem se escaneó en
-- parte (ej. 1 de 2), queda faltante con su contador (se ve 1/2).
-- pendientes_fin sigue guardando cuántas unidades faltaron.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.repo_finalizar(p_sesion uuid)
RETURNS TABLE (
  sesion_id uuid, estado text, iniciada_at timestamptz, tramo_desde timestamptz,
  segundos integer, unidades integer, pendientes_fin integer, ahora timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_lote uuid; v_local text; v_pend integer;
BEGIN
  SELECT s.lote_id, s.local INTO v_lote, v_local FROM public.repo_sesiones s
  WHERE s.id = p_sesion AND s.usuario_id = auth.uid() AND s.estado <> 'finalizada'
  FOR UPDATE;
  IF v_lote IS NULL THEN RAISE EXCEPTION 'La sesión ya estaba finalizada' USING ERRCODE = 'P0002'; END IF;

  SELECT coalesce(sum(GREATEST(i.cantidad - i.escaneadas, 0)), 0)::integer INTO v_pend
  FROM public.mayorista_items i
  WHERE i.lote_id = v_lote AND upper(coalesce(i.local, '')) = upper(v_local) AND i.estado = 'pendiente';

  -- Lo que no se escaneó queda como faltante (misma forma que la ✕ de Mayorista)
  UPDATE public.mayorista_items i
  SET estado = 'faltante', hecho_at = now(), hecho_por = auth.uid()
  WHERE i.lote_id = v_lote AND upper(coalesce(i.local, '')) = upper(v_local) AND i.estado = 'pendiente';

  UPDATE public.repo_sesiones s
  SET segundos = s.segundos + CASE WHEN s.estado = 'en_curso' AND s.tramo_desde IS NOT NULL
                                   THEN GREATEST(0, EXTRACT(epoch FROM now() - s.tramo_desde))::integer ELSE 0 END,
      estado = 'finalizada', tramo_desde = NULL, finalizada_at = now(), pendientes_fin = v_pend
  WHERE s.id = p_sesion;
  INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (p_sesion, 'fin');
  RETURN QUERY SELECT * FROM private.repo_sesion_json(p_sesion);
END;
$$;

COMMIT;
