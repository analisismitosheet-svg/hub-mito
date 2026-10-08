-- ============================================================================
-- Pausas del piso con MOTIVO (repo y armado), para medirlas
--
-- Aplicado en Supabase (migración piso_pausas). Idempotente.
--
-- piso_pausas: una fila por pausa (quién, repo o armado, motivo, desde, hasta).
--   * repo_pausar(p_sesion, p_motivo, p_detalle): pausa la sesión de la repo y
--     anota la pausa. La versión vieja sin motivo ya no deja pausar (para que no
--     se pueda saltear desde una app vieja). Cooldown de 15 min (repo_pausa_cooldown).
--   * armado_pausar(p_id, p_motivo, p_detalle) / armado_reanudar(p_id): el armado
--     no tenía pausa en la base; ahora queda anotada (mismo cooldown de 15 min).
--   * La pausa se cierra sola al Reanudar o Finalizar (trigger en
--     repo_sesion_eventos y en mayorista_armados).
--   * estadistica_pausas(desde, hasta): por empleado y motivo (Eficiencia mayorista).
-- Motivos: bano | comida | otra_tarea | falta_mercaderia | equipo | otro (otro pide detalle).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.piso_pausas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL DEFAULT auth.uid(),
  tipo       text NOT NULL CHECK (tipo IN ('repo', 'armado')),
  sesion_id  uuid,
  armado_id  uuid,
  lote_id    uuid,
  local      text,
  motivo     text NOT NULL CHECK (motivo IN ('bano', 'comida', 'otra_tarea', 'falta_mercaderia', 'equipo', 'otro')),
  detalle    text,
  desde      timestamptz NOT NULL DEFAULT now(),
  hasta      timestamptz
);
CREATE INDEX IF NOT EXISTS piso_pausas_desde_idx ON public.piso_pausas (desde DESC);
CREATE INDEX IF NOT EXISTS piso_pausas_sesion_idx ON public.piso_pausas (sesion_id) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS piso_pausas_armado_idx ON public.piso_pausas (armado_id) WHERE hasta IS NULL;

ALTER TABLE public.piso_pausas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.piso_pausas FROM anon, authenticated;
GRANT SELECT ON public.piso_pausas TO authenticated;
DROP POLICY IF EXISTS piso_pausas_ver ON public.piso_pausas;
CREATE POLICY piso_pausas_ver ON public.piso_pausas FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view'));

CREATE OR REPLACE FUNCTION private.pausa_validar(p_motivo text, p_detalle text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF coalesce(p_motivo, '') NOT IN ('bano', 'comida', 'otra_tarea', 'falta_mercaderia', 'equipo', 'otro') THEN
    RAISE EXCEPTION 'Elegí el motivo de la pausa' USING ERRCODE = '22023';
  END IF;
  IF p_motivo = 'otro' AND length(btrim(coalesce(p_detalle, ''))) < 3 THEN
    RAISE EXCEPTION 'Contá brevemente el motivo de la pausa' USING ERRCODE = '22023';
  END IF;
END; $$;

-- ---- Repo: pausar con motivo ----
CREATE OR REPLACE FUNCTION public.repo_pausar(p_sesion uuid, p_motivo text, p_detalle text DEFAULT NULL)
RETURNS TABLE(sesion_id uuid, estado text, iniciada_at timestamp with time zone, tramo_desde timestamp with time zone,
              segundos integer, unidades integer, pendientes_fin integer, ahora timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_libre timestamptz;
  v_s     public.repo_sesiones%ROWTYPE;
BEGIN
  PERFORM private.pausa_validar(p_motivo, p_detalle);
  v_libre := public.repo_proxima_pausa(p_sesion);
  IF v_libre IS NOT NULL AND v_libre > now() THEN
    RAISE EXCEPTION 'Podés volver a pausar en % min', ceil(extract(epoch FROM v_libre - now()) / 60)::integer
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.repo_sesiones s
  SET estado = 'pausada',
      segundos = s.segundos + GREATEST(0, EXTRACT(epoch FROM now() - s.tramo_desde))::integer,
      tramo_desde = NULL
  WHERE s.id = p_sesion AND s.usuario_id = auth.uid() AND s.estado = 'en_curso'
  RETURNING s.* INTO v_s;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'La sesión no está en curso' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (p_sesion, 'pausa');
  INSERT INTO public.piso_pausas (usuario_id, tipo, sesion_id, lote_id, local, motivo, detalle)
  VALUES (auth.uid(), 'repo', p_sesion, v_s.lote_id, v_s.local, p_motivo, nullif(btrim(coalesce(p_detalle, '')), ''));
  RETURN QUERY SELECT * FROM private.repo_sesion_json(p_sesion);
END;
$function$;

-- La versión vieja (sin motivo) ya no pausa
CREATE OR REPLACE FUNCTION public.repo_pausar(p_sesion uuid)
RETURNS TABLE(sesion_id uuid, estado text, iniciada_at timestamp with time zone, tramo_desde timestamp with time zone,
              segundos integer, unidades integer, pendientes_fin integer, ahora timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Actualizá la app (cerrala y volvé a abrirla): ahora la pausa pide un motivo' USING ERRCODE = '55000';
END;
$function$;

-- Reanudar / Finalizar la sesión de la repo cierran la pausa abierta
CREATE OR REPLACE FUNCTION private.pausa_cerrar_repo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.tipo IN ('reanudar', 'fin') THEN
    UPDATE public.piso_pausas SET hasta = NEW.at WHERE sesion_id = NEW.sesion_id AND hasta IS NULL;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS piso_pausas_cerrar ON public.repo_sesion_eventos;
CREATE TRIGGER piso_pausas_cerrar AFTER INSERT ON public.repo_sesion_eventos
  FOR EACH ROW EXECUTE FUNCTION private.pausa_cerrar_repo();

-- ---- Armado: pausar / reanudar (con motivo y cooldown) ----
CREATE OR REPLACE FUNCTION public.armado_pausar(p_id uuid, p_motivo text, p_detalle text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ult timestamptz;
BEGIN
  PERFORM private.pausa_validar(p_motivo, p_detalle);
  IF NOT EXISTS (SELECT 1 FROM public.mayorista_armados a WHERE a.id = p_id AND a.estado = 'aceptado' AND a.aceptado_por = auth.uid()) THEN
    RAISE EXCEPTION 'Ese armado no está en curso con vos' USING ERRCODE = 'P0002';
  END IF;
  SELECT max(desde) INTO v_ult FROM public.piso_pausas WHERE armado_id = p_id AND usuario_id = auth.uid();
  IF v_ult IS NOT NULL AND v_ult + interval '15 minutes' > now() THEN
    RAISE EXCEPTION 'Podés volver a pausar en % min', ceil(extract(epoch FROM v_ult + interval '15 minutes' - now()) / 60)::integer
      USING ERRCODE = '55000';
  END IF;
  -- Por las dudas, una sola pausa abierta
  UPDATE public.piso_pausas SET hasta = now() WHERE armado_id = p_id AND hasta IS NULL;
  INSERT INTO public.piso_pausas (usuario_id, tipo, armado_id, local, motivo, detalle)
  SELECT auth.uid(), 'armado', p_id, a.cliente, p_motivo, nullif(btrim(coalesce(p_detalle, '')), '')
    FROM public.mayorista_armados a WHERE a.id = p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.armado_reanudar(p_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.piso_pausas SET hasta = now() WHERE armado_id = p_id AND usuario_id = auth.uid() AND hasta IS NULL;
$$;

-- Desde cuándo puede volver a pausar el armado (cuenta regresiva del botón)
CREATE OR REPLACE FUNCTION public.armado_proxima_pausa(p_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT max(desde) + interval '15 minutes' FROM public.piso_pausas WHERE armado_id = p_id AND usuario_id = auth.uid()
$$;

-- Al terminar el armado se cierra la pausa que haya quedado abierta
CREATE OR REPLACE FUNCTION private.pausa_cerrar_armado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.estado = 'hecho' AND OLD.estado IS DISTINCT FROM 'hecho' THEN
    UPDATE public.piso_pausas SET hasta = now() WHERE armado_id = NEW.id AND hasta IS NULL;
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS piso_pausas_cerrar_armado ON public.mayorista_armados;
CREATE TRIGGER piso_pausas_cerrar_armado AFTER UPDATE ON public.mayorista_armados
  FOR EACH ROW EXECUTE FUNCTION private.pausa_cerrar_armado();

-- ---- Estadística: por empleado y motivo ----
CREATE OR REPLACE FUNCTION public.estadistica_pausas(p_desde date, p_hasta date)
RETURNS TABLE(usuario_id uuid, legajo text, nombre text, motivo text, pausas integer, segundos integer, abiertas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
    RAISE EXCEPTION 'Sin permiso para ver la estadística' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.usuario_id, u.legajo::text, coalesce(nullif(btrim(u.nombre), ''), u.email)::text, p.motivo,
         count(*)::integer,
         sum(extract(epoch FROM coalesce(p.hasta, now()) - p.desde))::integer,
         count(*) FILTER (WHERE p.hasta IS NULL)::integer
    FROM public.piso_pausas p
    LEFT JOIN public.usuarios u ON u.id = p.usuario_id
   WHERE (p.desde AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
   GROUP BY 1, 2, 3, 4;
END; $$;

REVOKE ALL ON FUNCTION public.repo_pausar(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_pausar(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_reanudar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_proxima_pausa(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estadistica_pausas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repo_pausar(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_pausar(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_reanudar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_proxima_pausa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estadistica_pausas(date, date) TO authenticated;
