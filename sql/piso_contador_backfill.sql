-- =====================================================
-- CONTADOR "escaneadas" DE LOS ÍTEMS YA HECHOS  (sigue a piso_tiempos.sql)
--
-- La columna mayorista_items.escaneadas se agregó con DEFAULT 0 y los ítems
-- que ya estaban "hecho" quedaron con 0: Mi repo los tomaba como pendientes,
-- Mayorista mostraba 0 escaneadas y repo_finalizar contaba faltantes de más.
--
-- 1. Backfill: hecho => escaneadas = cantidad (lo mismo que hace el trigger).
-- 2. escanear_codigo y repo_finalizar solo consideran ítems en estado
--    'pendiente' (defensa: un "hecho" nunca vuelve a contarse como pendiente).
-- =====================================================

BEGIN;

UPDATE public.mayorista_items
SET escaneadas = cantidad
WHERE estado = 'hecho' AND escaneadas < cantidad;

-- escanear_codigo: igual a piso_tiempos.sql, pero el candidato tiene que estar 'pendiente'
CREATE OR REPLACE FUNCTION public.escanear_codigo(p_lote uuid, p_local text, p_codigo text)
RETURNS TABLE (item_id uuid, item_escaneadas integer, item_cantidad integer, item_estado text, item_codigo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_id uuid;
  v_sesion uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF v_cod = '' THEN
    RAISE EXCEPTION 'Código vacío' USING ERRCODE = '22023';
  END IF;
  IF NOT private.puede_escanear(p_lote, p_local) THEN
    RAISE EXCEPTION 'Ese repo no está asignado a vos' USING ERRCODE = '42501';
  END IF;

  SELECT s.id INTO v_sesion FROM public.repo_sesiones s
  WHERE s.usuario_id = auth.uid() AND s.lote_id = p_lote
    AND upper(s.local) = upper(coalesce(p_local, '')) AND s.estado = 'en_curso'
  LIMIT 1;
  IF v_sesion IS NULL THEN
    RAISE EXCEPTION 'Tocá Iniciar (o Reanudar) antes de escanear' USING ERRCODE = '55000';
  END IF;

  SELECT i.id INTO v_id
  FROM public.mayorista_items i
  WHERE i.lote_id = p_lote
    AND upper(coalesce(i.local, '')) = upper(coalesce(p_local, ''))
    AND upper(regexp_replace(coalesce(i.codigo, ''), '\s', '', 'g')) = v_cod
    AND i.estado = 'pendiente'
    AND i.escaneadas < i.cantidad
  ORDER BY i.orden, i.id
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION '% no está pendiente en este repo', v_cod USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.repo_sesiones SET unidades = unidades + 1 WHERE id = v_sesion;

  RETURN QUERY
  UPDATE public.mayorista_items i
  SET escaneadas = i.escaneadas + 1,
      estado    = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN 'hecho' ELSE i.estado END,
      hecho_at  = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN now() ELSE i.hecho_at END,
      hecho_por = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN auth.uid() ELSE i.hecho_por END
  WHERE i.id = v_id
  RETURNING i.id, i.escaneadas, i.cantidad, i.estado, i.codigo;
END;
$$;

-- repo_finalizar: faltantes = unidades de ítems 'pendiente' sin completar
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
