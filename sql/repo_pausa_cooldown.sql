-- ============================================================================
-- Mi repo: Pausar tiene un cooldown de 15 minutos
--
-- Aplicado en Supabase (migración repo_pausa_cooldown). Idempotente.
--
-- Después de una pausa no se puede volver a pausar la misma sesión hasta que
-- pasen 15 minutos desde esa pausa. repo_proxima_pausa() le dice a la pantalla
-- desde cuándo puede (para mostrar la cuenta regresiva en el botón).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repo_proxima_pausa(p_sesion uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT max(e.at) + interval '15 minutes'
    FROM public.repo_sesion_eventos e
    JOIN public.repo_sesiones s ON s.id = e.sesion_id
   WHERE e.sesion_id = p_sesion AND e.tipo = 'pausa' AND s.usuario_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.repo_pausar(p_sesion uuid)
RETURNS TABLE(sesion_id uuid, estado text, iniciada_at timestamp with time zone, tramo_desde timestamp with time zone,
              segundos integer, unidades integer, pendientes_fin integer, ahora timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_libre timestamptz;
BEGIN
  v_libre := public.repo_proxima_pausa(p_sesion);
  IF v_libre IS NOT NULL AND v_libre > now() THEN
    RAISE EXCEPTION 'Podés volver a pausar en % min', ceil(extract(epoch FROM v_libre - now()) / 60)::integer
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.repo_sesiones s
  SET estado = 'pausada',
      segundos = s.segundos + GREATEST(0, EXTRACT(epoch FROM now() - s.tramo_desde))::integer,
      tramo_desde = NULL
  WHERE s.id = p_sesion AND s.usuario_id = auth.uid() AND s.estado = 'en_curso';
  IF NOT FOUND THEN RAISE EXCEPTION 'La sesión no está en curso' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (p_sesion, 'pausa');
  RETURN QUERY SELECT * FROM private.repo_sesion_json(p_sesion);
END;
$function$;

REVOKE ALL ON FUNCTION public.repo_proxima_pausa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repo_proxima_pausa(uuid) TO authenticated;
