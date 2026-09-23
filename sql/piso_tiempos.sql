-- =====================================================
-- TIEMPO REAL DE TRABAJO EN PISO (Mi repo)
--
-- Cada vez que un empleado trabaja un repo (lote + local) abre una SESIÓN:
--   Iniciar -> (Pausar <-> Reanudar)* -> Finalizar
-- El tiempo real = suma de los tramos "en curso" (las pausas no cuentan).
-- Solo se puede escanear con una sesión EN CURSO (ni antes de iniciar ni en pausa).
-- Finalizar se permite aunque falten unidades: queda registrado cuántas faltaron.
--
-- Tablas: repo_sesiones (1 fila por sesión) y repo_sesion_eventos (auditoría).
-- El piso NO escribe directo: todo pasa por las funciones repo_*().
-- Vista vw_tiempos_piso: tiempo real por empleado y día (pantalla Estadísticas).
--
-- Requiere: empleados_piso.sql y empleados_piso_seguridad_1/2.sql
-- Idempotente. Todo en una transacción.
-- =====================================================

BEGIN;

-- -----------------------------------------------------
-- 1. Tablas
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repo_sesiones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id          uuid NOT NULL REFERENCES public.mayorista_lotes(id) ON DELETE CASCADE,
  local            text NOT NULL,
  usuario_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empleado_id      uuid REFERENCES public.empleados(id) ON DELETE SET NULL,
  estado           text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'pausada', 'finalizada')),
  iniciada_at      timestamptz NOT NULL DEFAULT now(),
  -- inicio del tramo activo actual (null si está pausada o finalizada)
  tramo_desde      timestamptz DEFAULT now(),
  -- segundos de los tramos activos ya cerrados
  segundos         integer NOT NULL DEFAULT 0 CHECK (segundos >= 0),
  unidades         integer NOT NULL DEFAULT 0,   -- unidades escaneadas en esta sesión (neto de deshacer)
  pendientes_fin   integer,                      -- unidades que faltaban al finalizar
  finalizada_at    timestamptz
);

-- Una sola sesión abierta (en curso o pausada) por persona y repo
CREATE UNIQUE INDEX IF NOT EXISTS repo_sesiones_abierta_uq
  ON public.repo_sesiones (usuario_id, lote_id, upper(local))
  WHERE estado <> 'finalizada';
CREATE INDEX IF NOT EXISTS repo_sesiones_lote_idx ON public.repo_sesiones (lote_id, upper(local));
CREATE INDEX IF NOT EXISTS repo_sesiones_empleado_idx ON public.repo_sesiones (empleado_id, iniciada_at);

CREATE TABLE IF NOT EXISTS public.repo_sesion_eventos (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sesion_id   uuid NOT NULL REFERENCES public.repo_sesiones(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('inicio', 'pausa', 'reanudar', 'fin')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS repo_sesion_eventos_sesion_idx ON public.repo_sesion_eventos (sesion_id);

-- RLS: lectura propia o de quien supervisa mayorista. Escritura solo por funciones.
ALTER TABLE public.repo_sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repo_sesion_eventos ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.repo_sesiones FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.repo_sesion_eventos FROM anon, authenticated;
REVOKE ALL ON public.repo_sesiones FROM anon;
REVOKE ALL ON public.repo_sesion_eventos FROM anon;
GRANT SELECT ON public.repo_sesiones, public.repo_sesion_eventos TO authenticated;

DROP POLICY IF EXISTS "repo_sesiones_ver" ON public.repo_sesiones;
CREATE POLICY "repo_sesiones_ver" ON public.repo_sesiones
  FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR private.tiene_permiso('mayorista.view')
    OR private.tiene_permiso('mayorista.estadisticas.view')
  );

DROP POLICY IF EXISTS "repo_sesion_eventos_ver" ON public.repo_sesion_eventos;
CREATE POLICY "repo_sesion_eventos_ver" ON public.repo_sesion_eventos
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.repo_sesiones s WHERE s.id = sesion_id AND s.usuario_id = auth.uid())
    OR private.tiene_permiso('mayorista.view')
    OR private.tiene_permiso('mayorista.estadisticas.view')
  );


-- -----------------------------------------------------
-- 2. Funciones de la sesión
--    Todas devuelven la sesión + la hora del servidor (para que el
--    cronómetro del celular no dependa de su reloj).
-- -----------------------------------------------------
DROP FUNCTION IF EXISTS public.repo_sesion_actual(uuid, text);
DROP FUNCTION IF EXISTS public.repo_iniciar(uuid, text);
DROP FUNCTION IF EXISTS public.repo_pausar(uuid);
DROP FUNCTION IF EXISTS public.repo_reanudar(uuid);
DROP FUNCTION IF EXISTS public.repo_finalizar(uuid);

-- Vista interna de una sesión con el total de segundos al momento
CREATE OR REPLACE FUNCTION private.repo_sesion_json(p_id uuid)
RETURNS TABLE (
  sesion_id uuid, estado text, iniciada_at timestamptz, tramo_desde timestamptz,
  segundos integer, unidades integer, pendientes_fin integer, ahora timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.estado, s.iniciada_at, s.tramo_desde,
         s.segundos + CASE WHEN s.estado = 'en_curso' AND s.tramo_desde IS NOT NULL
                           THEN GREATEST(0, EXTRACT(epoch FROM now() - s.tramo_desde))::integer ELSE 0 END,
         s.unidades, s.pendientes_fin, now()
  FROM public.repo_sesiones s
  WHERE s.id = p_id;
$$;

-- Sesión abierta (en curso o pausada) del usuario en ese repo, o nada
CREATE FUNCTION public.repo_sesion_actual(p_lote uuid, p_local text)
RETURNS TABLE (
  sesion_id uuid, estado text, iniciada_at timestamptz, tramo_desde timestamptz,
  segundos integer, unidades integer, pendientes_fin integer, ahora timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT s.id INTO v_id FROM public.repo_sesiones s
  WHERE s.usuario_id = auth.uid() AND s.lote_id = p_lote
    AND upper(s.local) = upper(coalesce(p_local, '')) AND s.estado <> 'finalizada'
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT * FROM private.repo_sesion_json(v_id);
  END IF;
END;
$$;

CREATE FUNCTION public.repo_iniciar(p_lote uuid, p_local text)
RETURNS TABLE (
  sesion_id uuid, estado text, iniciada_at timestamptz, tramo_desde timestamptz,
  segundos integer, unidades integer, pendientes_fin integer, ahora timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT private.puede_escanear(p_lote, p_local) THEN
    RAISE EXCEPTION 'Ese repo no está asignado a vos' USING ERRCODE = '42501';
  END IF;

  -- Si ya hay una abierta, se devuelve esa (tocar Iniciar dos veces no duplica)
  SELECT s.id INTO v_id FROM public.repo_sesiones s
  WHERE s.usuario_id = auth.uid() AND s.lote_id = p_lote
    AND upper(s.local) = upper(coalesce(p_local, '')) AND s.estado <> 'finalizada'
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.repo_sesiones (lote_id, local, usuario_id, empleado_id)
    VALUES (p_lote, p_local, auth.uid(), private.mi_empleado_id())
    RETURNING id INTO v_id;
    INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (v_id, 'inicio');
  END IF;

  RETURN QUERY SELECT * FROM private.repo_sesion_json(v_id);
END;
$$;

CREATE FUNCTION public.repo_pausar(p_sesion uuid)
RETURNS TABLE (
  sesion_id uuid, estado text, iniciada_at timestamptz, tramo_desde timestamptz,
  segundos integer, unidades integer, pendientes_fin integer, ahora timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.repo_sesiones s
  SET estado = 'pausada',
      segundos = s.segundos + GREATEST(0, EXTRACT(epoch FROM now() - s.tramo_desde))::integer,
      tramo_desde = NULL
  WHERE s.id = p_sesion AND s.usuario_id = auth.uid() AND s.estado = 'en_curso';
  IF NOT FOUND THEN RAISE EXCEPTION 'La sesión no está en curso' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (p_sesion, 'pausa');
  RETURN QUERY SELECT * FROM private.repo_sesion_json(p_sesion);
END;
$$;

CREATE FUNCTION public.repo_reanudar(p_sesion uuid)
RETURNS TABLE (
  sesion_id uuid, estado text, iniciada_at timestamptz, tramo_desde timestamptz,
  segundos integer, unidades integer, pendientes_fin integer, ahora timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.repo_sesiones s
  SET estado = 'en_curso', tramo_desde = now()
  WHERE s.id = p_sesion AND s.usuario_id = auth.uid() AND s.estado = 'pausada';
  IF NOT FOUND THEN RAISE EXCEPTION 'La sesión no está pausada' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (p_sesion, 'reanudar');
  RETURN QUERY SELECT * FROM private.repo_sesion_json(p_sesion);
END;
$$;

CREATE FUNCTION public.repo_finalizar(p_sesion uuid)
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
  WHERE i.lote_id = v_lote AND upper(coalesce(i.local, '')) = upper(v_local) AND i.estado <> 'faltante';

  UPDATE public.repo_sesiones s
  SET segundos = s.segundos + CASE WHEN s.estado = 'en_curso' AND s.tramo_desde IS NOT NULL
                                   THEN GREATEST(0, EXTRACT(epoch FROM now() - s.tramo_desde))::integer ELSE 0 END,
      estado = 'finalizada', tramo_desde = NULL, finalizada_at = now(), pendientes_fin = v_pend
  WHERE s.id = p_sesion;
  INSERT INTO public.repo_sesion_eventos (sesion_id, tipo) VALUES (p_sesion, 'fin');
  RETURN QUERY SELECT * FROM private.repo_sesion_json(p_sesion);
END;
$$;

REVOKE ALL ON FUNCTION private.repo_sesion_json(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repo_sesion_actual(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repo_iniciar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repo_pausar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repo_reanudar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repo_finalizar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repo_sesion_actual(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repo_iniciar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repo_pausar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repo_reanudar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repo_finalizar(uuid) TO authenticated;


-- -----------------------------------------------------
-- 3. Escaneo: solo con sesión EN CURSO, y suma a la sesión
--    (misma lógica que empleados_piso_seguridad_1.sql + estos chequeos)
-- -----------------------------------------------------
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
    AND i.estado <> 'faltante'
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

CREATE OR REPLACE FUNCTION public.deshacer_escaneo(p_item uuid)
RETURNS TABLE (item_id uuid, item_escaneadas integer, item_cantidad integer, item_estado text, item_codigo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote uuid;
  v_local text;
  v_esc integer;
  v_sesion uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT i.lote_id, i.local, i.escaneadas INTO v_lote, v_local, v_esc
  FROM public.mayorista_items i
  WHERE i.id = p_item
  FOR UPDATE;

  IF v_lote IS NULL THEN
    RAISE EXCEPTION 'El artículo no existe' USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.puede_escanear(v_lote, v_local) THEN
    RAISE EXCEPTION 'Ese repo no está asignado a vos' USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_esc, 0) <= 0 THEN
    RAISE EXCEPTION 'No hay escaneos para deshacer' USING ERRCODE = 'P0002';
  END IF;

  SELECT s.id INTO v_sesion FROM public.repo_sesiones s
  WHERE s.usuario_id = auth.uid() AND s.lote_id = v_lote
    AND upper(s.local) = upper(coalesce(v_local, '')) AND s.estado = 'en_curso'
  LIMIT 1;
  IF v_sesion IS NULL THEN
    RAISE EXCEPTION 'Tocá Reanudar para poder deshacer' USING ERRCODE = '55000';
  END IF;

  UPDATE public.repo_sesiones SET unidades = GREATEST(unidades - 1, 0) WHERE id = v_sesion;

  RETURN QUERY
  UPDATE public.mayorista_items i
  SET escaneadas = i.escaneadas - 1,
      estado    = CASE WHEN i.estado = 'hecho' THEN 'pendiente' ELSE i.estado END,
      hecho_at  = CASE WHEN i.estado = 'hecho' THEN NULL ELSE i.hecho_at END,
      hecho_por = CASE WHEN i.estado = 'hecho' THEN NULL ELSE i.hecho_por END
  WHERE i.id = p_item
  RETURNING i.id, i.escaneadas, i.cantidad, i.estado, i.codigo;
END;
$$;


-- -----------------------------------------------------
-- 4. Tiempo real por empleado y día (Estadísticas de rendimiento)
--    security_invoker: respeta la RLS de repo_sesiones (quien no supervisa
--    mayorista solo ve lo suyo).
-- -----------------------------------------------------
CREATE OR REPLACE VIEW public.vw_tiempos_piso
WITH (security_invoker = true) AS
SELECT
  s.empleado_id,
  (s.iniciada_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS fecha,
  count(*)::integer                                   AS sesiones,
  count(DISTINCT (s.lote_id, upper(s.local)))::integer AS repos,
  sum(s.unidades)::integer                             AS unidades,
  sum(s.segundos)::integer                             AS segundos,
  sum(coalesce(s.pendientes_fin, 0))::integer          AS pendientes_fin
FROM public.repo_sesiones s
WHERE s.estado = 'finalizada'
GROUP BY s.empleado_id, (s.iniciada_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

REVOKE ALL ON public.vw_tiempos_piso FROM anon;
GRANT SELECT ON public.vw_tiempos_piso TO authenticated;

COMMIT;
