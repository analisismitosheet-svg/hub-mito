-- ============================================================================
-- Armado: los faltantes se cuentan en UNIDADES (no en renglones)
--
-- Aplicado en Supabase (migración armado_faltantes_unidades). Idempotente.
--
-- Antes armado_finalizar() guardaba en mayorista_armados.faltantes la CANTIDAD
-- DE RENGLONES que quedaban sin escanear, mientras que la repo guardaba
-- unidades en pedidos_venta_estado.faltantes. Eso hacía que "FALTAN n" en
-- Pedidos de venta significara cosas distintas según fuera armado o repo, y no
-- coincidía con la confirmación de la pantalla ("Quedan X unidades sin escanear").
-- Ahora ambos son unidades (cantidad - escaneadas).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.armado_finalizar(p_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acept uuid;
  v_est   text;
  v_fal   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT a.aceptado_por, a.estado INTO v_acept, v_est
    FROM public.mayorista_armados a WHERE a.id = p_id FOR UPDATE;
  IF v_acept IS NULL THEN
    RAISE EXCEPTION 'Ese armado no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_acept <> auth.uid() AND NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Ese armado lo está haciendo otro legajo' USING ERRCODE = '42501';
  END IF;
  IF v_est <> 'aceptado' THEN
    RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
  END IF;

  -- Faltantes en unidades de los renglones que quedaron pendientes
  SELECT coalesce(sum(greatest(i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad), 0)), 0)::integer
    INTO v_fal
    FROM public.mayorista_armados_items i
   WHERE i.armado_id = p_id AND i.estado = 'pendiente';

  UPDATE public.mayorista_armados_items i
     SET escaneadas = coalesce(i.escaneadas, 0),
         estado = 'faltante'
   WHERE i.armado_id = p_id
     AND i.estado = 'pendiente';

  UPDATE public.mayorista_armados
     SET estado = 'hecho',
         hecho_at = now(),
         faltantes = v_fal
   WHERE id = p_id;

  RETURN v_fal;
END;
$$;

-- Al cerrarse solo (se escaneó todo), los faltantes también son unidades
CREATE OR REPLACE FUNCTION private.armado_cerrar_si_listo(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pend integer;
  v_fal  integer;
BEGIN
  SELECT count(*) FILTER (WHERE i.estado = 'pendiente'),
         coalesce(
           sum(greatest(i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad), 0))
             FILTER (WHERE i.estado = 'faltante'),
           0
         )::integer
    INTO v_pend, v_fal
    FROM public.mayorista_armados_items i
   WHERE i.armado_id = p_id;

  IF v_pend > 0 THEN
    -- si se reabrió (hubo un deshacer), vuelve a en curso
    UPDATE public.mayorista_armados
       SET estado = CASE WHEN estado = 'hecho' THEN 'aceptado' ELSE estado END,
           hecho_at = CASE WHEN estado = 'hecho' THEN NULL ELSE hecho_at END,
           faltantes = CASE WHEN estado = 'hecho' THEN 0 ELSE faltantes END
     WHERE id = p_id AND estado = 'hecho' AND v_fal = 0;
    RETURN;
  END IF;

  UPDATE public.mayorista_armados
     SET estado = 'hecho',
         hecho_at = coalesce(hecho_at, now()),
         faltantes = v_fal
   WHERE id = p_id AND estado = 'aceptado';
END;
$$;

REVOKE ALL ON FUNCTION public.armado_finalizar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.armado_cerrar_si_listo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armado_finalizar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.armado_cerrar_si_listo(uuid) TO authenticated;
