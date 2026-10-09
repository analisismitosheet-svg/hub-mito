-- ============================================================================
-- Pausas del piso con AUTORIZACIÓN
--
-- Aplicado en Supabase (migración pausas_autorizacion). Idempotente.
--
-- Antes el legajo tocaba Pausar y la pausa arrancaba al toque. Ahora pide la
-- pausa y queda PENDIENTE: sigue trabajando (el cronómetro no frena) hasta que
-- alguien con el permiso mayorista.pausas.autorizar (o un admin) la autoriza.
-- Si la rechazan, no pasa nada: el legajo siguió trabajando.
--
-- piso_pausas suma el estado del pedido:
--   pendiente  -> pedida, esperando autorización (desde = NULL, todavía no pausa)
--   autorizada -> la pausa corre (desde = cuándo se autorizó)
--   rechazada  -> la rechazó el autorizador (motivo_rechazo); no hubo pausa
--   cancelada  -> la canceló el legajo o se cerró la tarea antes
-- Las pausas automáticas (motivo 'otra_tarea', al cambiar de tarea) nacen
-- autorizadas: no se piden.
--
-- Funciones nuevas:
--   repo_solicitar_pausa(sesion, motivo, detalle)   el legajo pide (repo)
--   armado_solicitar_pausa(id, motivo, detalle)     el legajo pide (armado)
--   pausa_cancelar(pausa)                            el legajo retira su pedido
--   pausa_autorizar(pausa) / pausa_rechazar(pausa)   el autorizador resuelve
--   pausas_pendientes()                              lista para la pantalla
-- repo_pausar() y armado_pausar() viejas ya no pausan (piden actualizar la app).
--
-- Motivos: bano | otra_tarea | falta_mercaderia | equipo | otro (otro pide
-- detalle). Se saca 'comida' (almuerzo / merienda) de lo que se puede elegir;
-- las pausas viejas con ese motivo quedan (solo para el historial).
-- ============================================================================

BEGIN;

-- ---- 1. Estado del pedido de pausa ----
ALTER TABLE public.piso_pausas
  ADD COLUMN IF NOT EXISTS estado         text NOT NULL DEFAULT 'autorizada',
  ADD COLUMN IF NOT EXISTS solicitada_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS autorizada_por uuid,
  ADD COLUMN IF NOT EXISTS autorizada_at  timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_rechazo text,
  ADD COLUMN IF NOT EXISTS push_at        timestamptz;

-- Una pausa pendiente no tiene 'desde' (arranca recién cuando la autorizan)
ALTER TABLE public.piso_pausas ALTER COLUMN desde DROP NOT NULL;

-- Las pausas viejas: autorizadas y con la fecha de pedido = cuándo arrancaron
UPDATE public.piso_pausas
   SET solicitada_at = desde
 WHERE solicitada_at > desde + interval '1 second';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.piso_pausas'::regclass AND conname = 'piso_pausas_estado_check'
  ) THEN
    ALTER TABLE public.piso_pausas
      ADD CONSTRAINT piso_pausas_estado_check
      CHECK (estado IN ('pendiente', 'autorizada', 'rechazada', 'cancelada'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS piso_pausas_pendientes_idx
  ON public.piso_pausas (solicitada_at DESC) WHERE estado = 'pendiente';

-- El autorizador tiene que poder ver las pausas de todos
DROP POLICY IF EXISTS piso_pausas_ver ON public.piso_pausas;
CREATE POLICY piso_pausas_ver ON public.piso_pausas FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR private.es_admin()
    OR private.tengo_permiso('mayorista.estadisticas.view')
    OR private.tengo_permiso('mayorista.pausas.autorizar')
  );

-- ---- 2. Permiso nuevo y asignación a puesto3 ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden)
VALUES ('mayorista.pausas.autorizar', 'mayorista', 'autorizar', 'Autorizar pausas del piso', 1260)
ON CONFLICT (clave) DO NOTHING;

-- Se lo damos a la cuenta puesto3 (después se puede dar o sacar desde Usuarios)
INSERT INTO public.usuario_permisos (usuario_id, permiso_clave, efecto)
SELECT u.id, 'mayorista.pausas.autorizar', 'grant'
  FROM public.usuarios u
 WHERE lower(u.email) = 'puesto3indo@gmail.com'
ON CONFLICT (usuario_id, permiso_clave) DO UPDATE SET efecto = 'grant';

-- ---- 3. Validación de motivos (se saca 'comida') ----
CREATE OR REPLACE FUNCTION private.pausa_validar(p_motivo text, p_detalle text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF coalesce(p_motivo, '') NOT IN ('bano', 'otra_tarea', 'falta_mercaderia', 'equipo', 'otro') THEN
    RAISE EXCEPTION 'Elegí el motivo de la pausa' USING ERRCODE = '22023';
  END IF;
  IF p_motivo = 'otro' AND length(btrim(coalesce(p_detalle, ''))) < 3 THEN
    RAISE EXCEPTION 'Contá brevemente el motivo de la pausa' USING ERRCODE = '22023';
  END IF;
END; $$;

-- ---- 4. Repo: pedir la pausa (queda pendiente) ----
CREATE OR REPLACE FUNCTION public.repo_solicitar_pausa(p_sesion uuid, p_motivo text, p_detalle text DEFAULT NULL)
RETURNS TABLE(pausa_id uuid, estado text, solicitada_at timestamptz, motivo text, detalle text, local text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_libre timestamptz;
  v      public.repo_sesiones%ROWTYPE;
  v_id   uuid;
BEGIN
  PERFORM private.pausa_validar(p_motivo, p_detalle);

  SELECT * INTO v FROM public.repo_sesiones s
   WHERE s.id = p_sesion AND s.usuario_id = auth.uid() AND s.estado = 'en_curso'
   FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'La sesión no está en curso' USING ERRCODE = 'P0002'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.piso_pausas pp
     WHERE pp.sesion_id = p_sesion AND pp.usuario_id = auth.uid() AND pp.estado = 'pendiente'
  ) THEN
    RAISE EXCEPTION 'Ya pediste una pausa: esperá que la autoricen' USING ERRCODE = '55000';
  END IF;

  v_libre := public.repo_proxima_pausa(p_sesion);
  IF v_libre IS NOT NULL AND v_libre > now() THEN
    RAISE EXCEPTION 'Podés volver a pausar en % min', ceil(extract(epoch FROM v_libre - now()) / 60)::integer
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.piso_pausas
    (usuario_id, tipo, sesion_id, lote_id, local, motivo, detalle, estado, solicitada_at)
  VALUES
    (auth.uid(), 'repo', p_sesion, v.lote_id, v.local, p_motivo,
     nullif(btrim(coalesce(p_detalle, '')), ''), 'pendiente', now())
  RETURNING id INTO v_id;

  RETURN QUERY
  SELECT pp.id, pp.estado, pp.solicitada_at, pp.motivo, pp.detalle, pp.local
    FROM public.piso_pausas pp WHERE pp.id = v_id;
END; $$;

-- ---- 5. Armado: pedir la pausa (queda pendiente) ----
CREATE OR REPLACE FUNCTION public.armado_solicitar_pausa(p_id uuid, p_motivo text, p_detalle text DEFAULT NULL)
RETURNS TABLE(pausa_id uuid, estado text, solicitada_at timestamptz, motivo text, detalle text, local text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_libre timestamptz;
  v_cli   text;
  v_id    uuid;
BEGIN
  PERFORM private.pausa_validar(p_motivo, p_detalle);

  SELECT a.cliente INTO v_cli FROM public.mayorista_armados a
   WHERE a.id = p_id AND a.estado = 'aceptado' AND a.aceptado_por = auth.uid()
     AND a.crono_estado = 'en_curso'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese armado no está en curso con vos' USING ERRCODE = 'P0002'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.piso_pausas pp
     WHERE pp.armado_id = p_id AND pp.usuario_id = auth.uid() AND pp.estado = 'pendiente'
  ) THEN
    RAISE EXCEPTION 'Ya pediste una pausa: esperá que la autoricen' USING ERRCODE = '55000';
  END IF;

  v_libre := public.armado_proxima_pausa(p_id);
  IF v_libre IS NOT NULL AND v_libre > now() THEN
    RAISE EXCEPTION 'Podés volver a pausar en % min', ceil(extract(epoch FROM v_libre - now()) / 60)::integer
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.piso_pausas
    (usuario_id, tipo, armado_id, local, motivo, detalle, estado, solicitada_at)
  VALUES
    (auth.uid(), 'armado', p_id, v_cli, p_motivo,
     nullif(btrim(coalesce(p_detalle, '')), ''), 'pendiente', now())
  RETURNING id INTO v_id;

  RETURN QUERY
  SELECT pp.id, pp.estado, pp.solicitada_at, pp.motivo, pp.detalle, pp.local
    FROM public.piso_pausas pp WHERE pp.id = v_id;
END; $$;

-- ---- 6. El legajo retira su pedido ----
CREATE OR REPLACE FUNCTION public.pausa_cancelar(p_pausa uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.piso_pausas SET estado = 'cancelada'
   WHERE id = p_pausa AND usuario_id = auth.uid() AND estado = 'pendiente';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END; $$;

-- ---- 7. El autorizador resuelve ----
CREATE OR REPLACE FUNCTION public.pausa_autorizar(p_pausa uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.piso_pausas%ROWTYPE;
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.pausas.autorizar')) THEN
    RAISE EXCEPTION 'Sin permiso para autorizar pausas' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.piso_pausas WHERE id = p_pausa FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'La pausa no existe' USING ERRCODE = 'P0002'; END IF;
  IF r.estado <> 'pendiente' THEN RAISE EXCEPTION 'Esa pausa ya fue resuelta' USING ERRCODE = '55000'; END IF;

  IF r.tipo = 'repo' THEN
    UPDATE public.repo_sesiones s
       SET estado = 'pausada',
           segundos = s.segundos + GREATEST(0, EXTRACT(epoch FROM now() - s.tramo_desde))::integer,
           tramo_desde = NULL
     WHERE s.id = r.sesion_id AND s.usuario_id = r.usuario_id AND s.estado = 'en_curso';
    IF NOT FOUND THEN
      UPDATE public.piso_pausas SET estado = 'cancelada' WHERE id = r.id;
      RAISE EXCEPTION 'La sesión de repo ya no está en curso' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (r.sesion_id, 'pausa');
  ELSIF r.tipo = 'armado' THEN
    UPDATE public.mayorista_armados a
       SET crono_segundos = a.crono_segundos + CASE WHEN a.crono_estado = 'en_curso'
                                  THEN greatest(0, extract(epoch FROM now() - coalesce(a.crono_desde, now())))::integer ELSE 0 END,
           crono_estado = 'pausada',
           crono_desde  = NULL
     WHERE a.id = r.armado_id AND a.aceptado_por = r.usuario_id AND a.estado = 'aceptado';
    IF NOT FOUND THEN
      UPDATE public.piso_pausas SET estado = 'cancelada' WHERE id = r.id;
      RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.piso_pausas
     SET estado = 'autorizada', desde = now(),
         autorizada_por = auth.uid(), autorizada_at = now()
   WHERE id = r.id;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.pausa_rechazar(p_pausa uuid, p_motivo text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.pausas.autorizar')) THEN
    RAISE EXCEPTION 'Sin permiso para autorizar pausas' USING ERRCODE = '42501';
  END IF;

  UPDATE public.piso_pausas
     SET estado = 'rechazada',
         hasta = coalesce(hasta, now()),
         autorizada_por = auth.uid(),
         autorizada_at = now(),
         motivo_rechazo = nullif(btrim(coalesce(p_motivo, '')), '')
   WHERE id = p_pausa AND estado = 'pendiente';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'Esa pausa ya fue resuelta' USING ERRCODE = '55000'; END IF;
  RETURN true;
END; $$;

-- ---- 8. Lista para la pantalla del autorizador ----
CREATE OR REPLACE FUNCTION public.pausas_pendientes()
RETURNS TABLE(pausa_id uuid, tipo text, motivo text, detalle text, solicitada_at timestamptz,
              usuario_id uuid, legajo text, nombre text, sesion_id uuid, armado_id uuid,
              local text, cliente text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.pausas.autorizar')) THEN
    RAISE EXCEPTION 'Sin permiso para ver las pausas' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pp.id, pp.tipo, pp.motivo, pp.detalle, pp.solicitada_at,
         pp.usuario_id, u.legajo::text,
         coalesce(nullif(btrim(u.nombre), ''), u.email)::text,
         pp.sesion_id, pp.armado_id, pp.local, a.cliente
    FROM public.piso_pausas pp
    LEFT JOIN public.usuarios u ON u.id = pp.usuario_id
    LEFT JOIN public.mayorista_armados a ON a.id = pp.armado_id
   WHERE pp.estado = 'pendiente'
   ORDER BY pp.solicitada_at ASC;
END; $$;

-- ---- 9. Las pausas viejas (sin autorización) ya no pausan ----
CREATE OR REPLACE FUNCTION public.repo_pausar(p_sesion uuid, p_motivo text, p_detalle text DEFAULT NULL)
RETURNS TABLE(sesion_id uuid, estado text, iniciada_at timestamp with time zone, tramo_desde timestamp with time zone,
              segundos integer, unidades integer, pendientes_fin integer, ahora timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Actualizá la app (cerrala y volvé a abrirla): ahora la pausa la autoriza el puesto' USING ERRCODE = '55000';
END; $function$;

CREATE OR REPLACE FUNCTION public.armado_pausar(p_id uuid, p_motivo text, p_detalle text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Actualizá la app (cerrala y volvé a abrirla): ahora la pausa la autoriza el puesto' USING ERRCODE = '55000';
END; $$;

-- ---- 10. Cooldown: cuenta desde que se pidió (o autorizó), sin las canceladas ----
CREATE OR REPLACE FUNCTION public.repo_proxima_pausa(p_sesion uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT max(coalesce(pp.desde, pp.solicitada_at)) + interval '15 minutes'
    FROM public.piso_pausas pp
   WHERE pp.sesion_id = p_sesion AND pp.usuario_id = auth.uid()
     AND pp.motivo <> 'otra_tarea' AND pp.estado <> 'cancelada'
$$;

CREATE OR REPLACE FUNCTION public.armado_proxima_pausa(p_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT max(coalesce(pp.desde, pp.solicitada_at)) + interval '15 minutes'
    FROM public.piso_pausas pp
   WHERE pp.armado_id = p_id AND pp.usuario_id = auth.uid()
     AND pp.motivo <> 'otra_tarea' AND pp.estado <> 'cancelada'
$$;

-- ---- 11. Cierre de pausas: solo cierra las autorizadas, cancela las pendientes ----
CREATE OR REPLACE FUNCTION private.pausa_cerrar_repo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.tipo IN ('reanudar', 'fin') THEN
    UPDATE public.piso_pausas SET hasta = NEW.at
     WHERE sesion_id = NEW.sesion_id AND estado = 'autorizada' AND hasta IS NULL;
    UPDATE public.piso_pausas SET estado = 'cancelada', hasta = coalesce(hasta, NEW.at)
     WHERE sesion_id = NEW.sesion_id AND estado = 'pendiente';
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS piso_pausas_cerrar ON public.repo_sesion_eventos;
CREATE TRIGGER piso_pausas_cerrar AFTER INSERT ON public.repo_sesion_eventos
  FOR EACH ROW EXECUTE FUNCTION private.pausa_cerrar_repo();

CREATE OR REPLACE FUNCTION private.pausa_cerrar_armado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.estado = 'hecho' AND OLD.estado IS DISTINCT FROM 'hecho' THEN
    UPDATE public.piso_pausas SET hasta = now()
     WHERE armado_id = NEW.id AND estado = 'autorizada' AND hasta IS NULL;
    UPDATE public.piso_pausas SET estado = 'cancelada', hasta = coalesce(hasta, now())
     WHERE armado_id = NEW.id AND estado = 'pendiente';
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS piso_pausas_cerrar_armado ON public.mayorista_armados;
CREATE TRIGGER piso_pausas_cerrar_armado AFTER UPDATE ON public.mayorista_armados
  FOR EACH ROW EXECUTE FUNCTION private.pausa_cerrar_armado();

-- ---- 12. Cambiar de tarea pausa lo demás: respeta el estado ----
CREATE OR REPLACE FUNCTION private.pausar_lo_demas(p_usuario uuid, p_armado uuid, p_sesion uuid, p_detalle text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
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
    UPDATE public.piso_pausas SET hasta = now()
     WHERE armado_id = r.id AND estado = 'autorizada' AND hasta IS NULL;
    UPDATE public.piso_pausas SET estado = 'cancelada', hasta = coalesce(hasta, now())
     WHERE armado_id = r.id AND estado = 'pendiente';
    INSERT INTO public.piso_pausas (usuario_id, tipo, armado_id, local, motivo, detalle)
    VALUES (p_usuario, 'armado', r.id, r.cliente, 'otra_tarea', p_detalle);
  END LOOP;

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
    UPDATE public.piso_pausas SET hasta = now()
     WHERE sesion_id = r.id AND estado = 'autorizada' AND hasta IS NULL;
    UPDATE public.piso_pausas SET estado = 'cancelada', hasta = coalesce(hasta, now())
     WHERE sesion_id = r.id AND estado = 'pendiente';
    INSERT INTO public.piso_pausas (usuario_id, tipo, sesion_id, lote_id, local, motivo, detalle)
    VALUES (p_usuario, 'repo', r.id, r.lote_id, r.local, 'otra_tarea', p_detalle);
  END LOOP;
END; $$;

-- ---- 13. Iniciar/Reanudar armado: cierra la pausa propia y cancela pendientes ----
CREATE OR REPLACE FUNCTION public.armado_iniciar(p_id uuid)
RETURNS TABLE(estado text, segundos integer, desde timestamptz, ahora timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_num integer; v_cod text;
BEGIN
  SELECT a.pedido_numero, a.pedido_codigo INTO v_num, v_cod FROM public.mayorista_armados a
   WHERE a.id = p_id AND a.estado = 'aceptado' AND a.aceptado_por = auth.uid() FOR UPDATE;
  IF v_cod IS NULL THEN RAISE EXCEPTION 'Ese armado no está en curso con vos' USING ERRCODE = 'P0002'; END IF;

  PERFORM private.pausar_lo_demas(auth.uid(), p_id, NULL, 'Pasó al pedido N° ' || coalesce(v_num::text, v_cod));

  UPDATE public.piso_pausas AS pp SET hasta = now()
   WHERE pp.armado_id = p_id AND pp.estado = 'autorizada' AND pp.hasta IS NULL;
  UPDATE public.piso_pausas AS pp SET estado = 'cancelada', hasta = coalesce(pp.hasta, now())
   WHERE pp.armado_id = p_id AND pp.estado = 'pendiente';
  UPDATE public.mayorista_armados
     SET crono_estado = 'en_curso',
         iniciado_at = coalesce(iniciado_at, now()),
         crono_desde = coalesce(CASE WHEN crono_estado = 'en_curso' THEN crono_desde END, now())
   WHERE id = p_id;
  RETURN QUERY SELECT * FROM public.armado_crono(p_id);
END; $$;

-- ---- 14. Estadística de pausas: solo las que realmente pasaron ----
CREATE OR REPLACE FUNCTION public.estadistica_pausas(p_desde date, p_hasta date)
RETURNS TABLE(usuario_id uuid, legajo text, nombre text, motivo text, pausas integer, segundos integer, abiertas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
   WHERE p.estado = 'autorizada'
     AND p.desde IS NOT NULL
     AND (p.desde AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
   GROUP BY 1, 2, 3, 4;
END; $$;

-- ---- 15. Permisos de ejecución ----
REVOKE ALL ON FUNCTION public.repo_solicitar_pausa(uuid, text, text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_solicitar_pausa(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pausa_cancelar(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pausa_autorizar(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pausa_rechazar(uuid, text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pausas_pendientes()                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repo_pausar(uuid, text, text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_pausar(uuid, text, text)          FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.repo_solicitar_pausa(uuid, text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_solicitar_pausa(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pausa_cancelar(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.pausa_autorizar(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.pausa_rechazar(uuid, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.pausas_pendientes()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.repo_pausar(uuid, text, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_pausar(uuid, text, text)          TO authenticated;

-- ---- 16. Publicar piso_pausas para que la pantalla se actualice en vivo ----
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'piso_pausas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.piso_pausas;
  END IF;
END $$;

COMMIT;
