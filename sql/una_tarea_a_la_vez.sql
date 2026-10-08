-- ============================================================================
-- Mi repo: el cronómetro del armado se guarda en la base + UNA tarea a la vez
--
-- Aplicado en Supabase (migración una_tarea_a_la_vez). Idempotente.
--
-- Antes el cronómetro del armado vivía solo en la pantalla: al volver al menú de
-- Mi repo se perdía y había que tocar Iniciar de nuevo (y el tiempo no se guardaba).
-- Ahora va en mayorista_armados (crono_estado / crono_segundos / crono_desde) y
-- sigue corriendo aunque se salga de la pantalla o se cierre la app.
--
-- Una sola tarea en marcha por persona: al Iniciar/Reanudar un armado o una repo,
-- lo que el legajo tenía en curso (otro armado u otra repo) se pausa solo, con
-- motivo 'otra_tarea' ("Pasó a …") en piso_pausas. Ej.: está con un Normal, entra
-- un Urgente, toca Iniciar en el Urgente y el Normal queda en pausa.
-- ============================================================================

ALTER TABLE public.mayorista_armados
  ADD COLUMN IF NOT EXISTS crono_estado   text NOT NULL DEFAULT 'inactiva',
  ADD COLUMN IF NOT EXISTS crono_segundos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crono_desde    timestamptz;

-- ---- Pausa todo lo que el usuario tenga en marcha, menos lo indicado ----
CREATE OR REPLACE FUNCTION private.pausar_lo_demas(p_usuario uuid, p_armado uuid, p_sesion uuid, p_detalle text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  -- Armados en marcha
  FOR r IN
    SELECT a.id, a.cliente FROM public.mayorista_armados a
     WHERE a.aceptado_por = p_usuario AND a.estado = 'aceptado' AND a.crono_estado = 'en_curso'
       AND a.id IS DISTINCT FROM p_armado
     FOR UPDATE
  LOOP
    UPDATE public.mayorista_armados
       SET crono_segundos = crono_segundos + greatest(0, extract(epoch FROM now() - coalesce(crono_desde, now())))::integer,
           crono_estado = 'pausada', crono_desde = NULL
     WHERE id = r.id;
    UPDATE public.piso_pausas SET hasta = now() WHERE armado_id = r.id AND hasta IS NULL;
    INSERT INTO public.piso_pausas (usuario_id, tipo, armado_id, local, motivo, detalle)
    VALUES (p_usuario, 'armado', r.id, r.cliente, 'otra_tarea', p_detalle);
  END LOOP;

  -- Repos en marcha
  FOR r IN
    SELECT s.id, s.lote_id, s.local FROM public.repo_sesiones s
     WHERE s.usuario_id = p_usuario AND s.estado = 'en_curso' AND s.id IS DISTINCT FROM p_sesion
     FOR UPDATE
  LOOP
    UPDATE public.repo_sesiones s
       SET estado = 'pausada',
           segundos = s.segundos + greatest(0, extract(epoch FROM now() - s.tramo_desde))::integer,
           tramo_desde = NULL
     WHERE s.id = r.id;
    INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (r.id, 'pausa');
    INSERT INTO public.piso_pausas (usuario_id, tipo, sesion_id, lote_id, local, motivo, detalle)
    VALUES (p_usuario, 'repo', r.id, r.lote_id, r.local, 'otra_tarea', p_detalle);
  END LOOP;
END;
$$;

-- ---- Cronómetro del armado ----
CREATE OR REPLACE FUNCTION public.armado_crono(p_id uuid)
RETURNS TABLE(estado text, segundos integer, desde timestamptz, ahora timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.crono_estado, a.crono_segundos, a.crono_desde, now()
    FROM public.mayorista_armados a
   WHERE a.id = p_id AND (a.aceptado_por = auth.uid() OR private.es_admin() OR private.tengo_permiso('pedidos_venta.view'))
$$;

CREATE OR REPLACE FUNCTION public.armado_iniciar(p_id uuid)
RETURNS TABLE(estado text, segundos integer, desde timestamptz, ahora timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_num integer; v_cod text;
BEGIN
  SELECT a.pedido_numero, a.pedido_codigo INTO v_num, v_cod FROM public.mayorista_armados a
   WHERE a.id = p_id AND a.estado = 'aceptado' AND a.aceptado_por = auth.uid() FOR UPDATE;
  IF v_cod IS NULL THEN RAISE EXCEPTION 'Ese armado no está en curso con vos' USING ERRCODE = 'P0002'; END IF;

  PERFORM private.pausar_lo_demas(auth.uid(), p_id, NULL, 'Pasó al pedido N° ' || coalesce(v_num::text, v_cod));

  UPDATE public.piso_pausas SET hasta = now() WHERE armado_id = p_id AND hasta IS NULL;
  UPDATE public.mayorista_armados
     SET crono_estado = 'en_curso', crono_desde = coalesce(CASE WHEN crono_estado = 'en_curso' THEN crono_desde END, now())
   WHERE id = p_id;
  RETURN QUERY SELECT * FROM public.armado_crono(p_id);
END;
$$;

-- Reanudar = Iniciar (también pausa lo demás)
CREATE OR REPLACE FUNCTION public.armado_reanudar(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.armado_iniciar(p_id);
END;
$$;

-- Pausar con motivo: ahora también frena el cronómetro guardado
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
  SELECT max(pp.desde) INTO v_ult FROM public.piso_pausas pp
   WHERE pp.armado_id = p_id AND pp.usuario_id = auth.uid() AND pp.motivo <> 'otra_tarea';
  IF v_ult IS NOT NULL AND v_ult + interval '15 minutes' > now() THEN
    RAISE EXCEPTION 'Podés volver a pausar en % min', ceil(extract(epoch FROM v_ult + interval '15 minutes' - now()) / 60)::integer
      USING ERRCODE = '55000';
  END IF;
  UPDATE public.mayorista_armados
     SET crono_segundos = crono_segundos + CASE WHEN crono_estado = 'en_curso'
                            THEN greatest(0, extract(epoch FROM now() - coalesce(crono_desde, now())))::integer ELSE 0 END,
         crono_estado = 'pausada', crono_desde = NULL
   WHERE id = p_id;
  UPDATE public.piso_pausas SET hasta = now() WHERE armado_id = p_id AND hasta IS NULL;
  INSERT INTO public.piso_pausas (usuario_id, tipo, armado_id, local, motivo, detalle)
  SELECT auth.uid(), 'armado', p_id, a.cliente, p_motivo, nullif(btrim(coalesce(p_detalle, '')), '')
    FROM public.mayorista_armados a WHERE a.id = p_id;
END; $$;

-- El cooldown cuenta solo las pausas que pidió la persona (no las automáticas por cambiar de tarea)
CREATE OR REPLACE FUNCTION public.armado_proxima_pausa(p_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT max(desde) + interval '15 minutes' FROM public.piso_pausas
   WHERE armado_id = p_id AND usuario_id = auth.uid() AND motivo <> 'otra_tarea'
$$;

-- Al terminar el armado (Finalizar o se completa solo) se suma el último tramo
CREATE OR REPLACE FUNCTION private.armado_crono_al_terminar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'hecho' AND OLD.estado IS DISTINCT FROM 'hecho' THEN
    IF NEW.crono_estado = 'en_curso' THEN
      NEW.crono_segundos := NEW.crono_segundos + greatest(0, extract(epoch FROM now() - coalesce(NEW.crono_desde, now())))::integer;
    END IF;
    NEW.crono_estado := 'finalizado';
    NEW.crono_desde := NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS mayorista_armados_crono ON public.mayorista_armados;
CREATE TRIGGER mayorista_armados_crono BEFORE UPDATE ON public.mayorista_armados
  FOR EACH ROW EXECUTE FUNCTION private.armado_crono_al_terminar();

-- ---- Repo: Iniciar / Reanudar también pausan lo demás ----
CREATE OR REPLACE FUNCTION public.repo_iniciar(p_lote uuid, p_local text)
RETURNS TABLE(sesion_id uuid, estado text, iniciada_at timestamp with time zone, tramo_desde timestamp with time zone,
              segundos integer, unidades integer, pendientes_fin integer, ahora timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT private.puede_escanear(p_lote, p_local) THEN
    RAISE EXCEPTION 'Ese repo no está asignado a vos' USING ERRCODE = '42501';
  END IF;

  SELECT s.id INTO v_id FROM public.repo_sesiones s
  WHERE s.usuario_id = auth.uid() AND s.lote_id = p_lote
    AND upper(s.local) = upper(coalesce(p_local, '')) AND s.estado <> 'finalizada'
  LIMIT 1;

  PERFORM private.pausar_lo_demas(auth.uid(), NULL, v_id, 'Pasó a la repo de ' || coalesce(p_local, ''));

  IF v_id IS NULL THEN
    INSERT INTO public.repo_sesiones (lote_id, local, usuario_id, empleado_id)
    VALUES (p_lote, p_local, auth.uid(), private.mi_empleado_id())
    RETURNING id INTO v_id;
    INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (v_id, 'inicio');
  END IF;

  RETURN QUERY SELECT * FROM private.repo_sesion_json(v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.repo_reanudar(p_sesion uuid)
RETURNS TABLE(sesion_id uuid, estado text, iniciada_at timestamp with time zone, tramo_desde timestamp with time zone,
              segundos integer, unidades integer, pendientes_fin integer, ahora timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_local text;
BEGIN
  SELECT s.local INTO v_local FROM public.repo_sesiones s WHERE s.id = p_sesion AND s.usuario_id = auth.uid();
  PERFORM private.pausar_lo_demas(auth.uid(), NULL, p_sesion, 'Pasó a la repo de ' || coalesce(v_local, ''));
  UPDATE public.repo_sesiones s
  SET estado = 'en_curso', tramo_desde = now()
  WHERE s.id = p_sesion AND s.usuario_id = auth.uid() AND s.estado = 'pausada';
  IF NOT FOUND THEN RAISE EXCEPTION 'La sesión no está pausada' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (p_sesion, 'reanudar');
  RETURN QUERY SELECT * FROM private.repo_sesion_json(p_sesion);
END;
$function$;

-- El cooldown de la repo tampoco cuenta las pausas automáticas
CREATE OR REPLACE FUNCTION public.repo_proxima_pausa(p_sesion uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT max(pp.desde) + interval '15 minutes'
    FROM public.piso_pausas pp
   WHERE pp.sesion_id = p_sesion AND pp.usuario_id = auth.uid() AND pp.motivo <> 'otra_tarea'
$$;

REVOKE ALL ON FUNCTION private.pausar_lo_demas(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.armado_crono(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_iniciar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armado_crono(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_iniciar(uuid) TO authenticated;
