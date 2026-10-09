-- ============================================================================
-- Armado de pedidos: el legajo puede SOLTAR un armado que tiene en curso
--
-- Aplicado en Supabase (migración armado_rechazar). Idempotente.
--
-- Hoy el armado lo toma el primero que toca Acepto y queda 'aceptado' (en
-- curso). Con esto, si el legajo no lo puede hacer (lo mandaron a otra tarea,
-- se equivocó, etc.) lo puede SOLTAR con un motivo: el armado vuelve a
-- 'pendiente' para todo el piso y queda registrado quién y por qué.
--
-- Se conserva lo escaneado (el que lo tome sigue desde ahí); se resetea el
-- cronómetro porque empieza a correr para el nuevo legajo.
--
-- armado_rechazar(p_id, p_motivo): solo el legajo que lo aceptó (o el admin).
-- Deja en mayorista_armados el motivo, quién y cuándo (liberado_*), y lo refleja
-- en pedidos_venta_estado para que Pedidos de venta lo muestre.
-- ============================================================================

BEGIN;

ALTER TABLE public.mayorista_armados
  ADD COLUMN IF NOT EXISTS liberado_motivo text,
  ADD COLUMN IF NOT EXISTS liberado_at     timestamptz,
  ADD COLUMN IF NOT EXISTS liberado_por    uuid,
  ADD COLUMN IF NOT EXISTS liberado_nombre text,
  ADD COLUMN IF NOT EXISTS liberado_veces  integer NOT NULL DEFAULT 0;

ALTER TABLE public.pedidos_venta_estado
  ADD COLUMN IF NOT EXISTS liberado_motivo text,
  ADD COLUMN IF NOT EXISTS liberado_nombre text,
  ADD COLUMN IF NOT EXISTS liberado_at     timestamptz;

-- ---- pve_recalcular: copia también el motivo de la última liberación ----
CREATE OR REPLACE FUNCTION private.pve_recalcular(p_codigo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ped  public.pedidos_venta%ROWTYPE;
  v_arm  public.mayorista_armados%ROWTYPE;
  v_lote uuid;
  v_loc  text;
  r      record;
BEGIN
  SELECT * INTO v_ped FROM public.pedidos_venta WHERE codigo = p_codigo;
  IF v_ped.codigo IS NULL THEN
    DELETE FROM public.pedidos_venta_estado WHERE codigo = p_codigo;
    RETURN;
  END IF;

  -- 1) Armado (el más nuevo): gana el legajo que lo aceptó
  SELECT * INTO v_arm FROM public.mayorista_armados WHERE pedido_codigo = p_codigo ORDER BY creado_at DESC LIMIT 1;
  IF v_arm.id IS NOT NULL THEN
    SELECT count(*)::integer AS lineas,
           count(*) FILTER (WHERE ai.estado <> 'pendiente')::integer AS lineas_ok,
           coalesce(sum(ai.cantidad), 0)::integer AS unidades,
           coalesce(sum(least(coalesce(ai.escaneadas, 0), ai.cantidad)), 0)::integer AS unidades_ok
      INTO r FROM public.mayorista_armados_items ai WHERE ai.armado_id = v_arm.id;
    INSERT INTO public.pedidos_venta_estado AS e
      (codigo, fecha, origen, estado, armado_id, lote_id, local, prioridad, obs, legajo, nombre,
       lineas, lineas_ok, unidades, unidades_ok, faltantes, liberado_motivo, liberado_nombre, liberado_at, actualizado_at)
    VALUES (p_codigo, v_ped.fecha, 'armado', v_arm.estado, v_arm.id, NULL, v_arm.asignado_local, v_arm.prioridad, v_arm.obs,
            coalesce(v_arm.aceptado_legajo, v_arm.asignado_legajo), coalesce(v_arm.aceptado_nombre, v_arm.asignado_nombre),
            r.lineas, r.lineas_ok, r.unidades, r.unidades_ok, v_arm.faltantes,
            v_arm.liberado_motivo, v_arm.liberado_nombre, v_arm.liberado_at, now())
    ON CONFLICT (codigo) DO UPDATE SET
      fecha = excluded.fecha, origen = excluded.origen, estado = excluded.estado, armado_id = excluded.armado_id,
      lote_id = NULL, local = excluded.local, prioridad = excluded.prioridad, obs = excluded.obs,
      legajo = excluded.legajo, nombre = excluded.nombre, lineas = excluded.lineas, lineas_ok = excluded.lineas_ok,
      unidades = excluded.unidades, unidades_ok = excluded.unidades_ok, faltantes = excluded.faltantes,
      liberado_motivo = excluded.liberado_motivo, liberado_nombre = excluded.liberado_nombre,
      liberado_at = excluded.liberado_at, actualizado_at = now();
    RETURN;
  END IF;

  IF v_ped.motivo IS DISTINCT FROM 'VTD' THEN
    DELETE FROM public.pedidos_venta_estado WHERE codigo = p_codigo;
    RETURN;
  END IF;

  -- 2) VTD: la repo de ese día que tiene ese local
  v_loc := upper(btrim(coalesce(v_ped.cliente, '')));
  SELECT l.id INTO v_lote FROM public.mayorista_lotes l
   WHERE l.fecha = v_ped.fecha
     AND EXISTS (SELECT 1 FROM public.mayorista_items mi WHERE mi.lote_id = l.id AND upper(btrim(mi.local)) = v_loc)
   ORDER BY l.created_at DESC LIMIT 1;

  IF v_lote IS NOT NULL THEN
    SELECT count(*)::integer AS lineas,
           count(*) FILTER (WHERE mi.estado <> 'pendiente')::integer AS lineas_ok,
           count(*) FILTER (WHERE mi.estado = 'pendiente')::integer AS pend,
           coalesce(sum(mi.cantidad), 0)::integer AS unidades,
           coalesce(sum(CASE WHEN mi.estado = 'hecho' THEN mi.cantidad ELSE least(coalesce(mi.escaneadas, 0), mi.cantidad) END), 0)::integer AS unidades_ok,
           coalesce(sum(CASE WHEN mi.estado = 'faltante' THEN mi.cantidad - least(coalesce(mi.escaneadas, 0), mi.cantidad) ELSE 0 END), 0)::integer AS faltantes,
           (SELECT e.legajo::text FROM public.mayorista_responsables rr JOIN public.empleados e ON e.id = rr.empleado_id
             WHERE rr.lote_id = v_lote AND upper(btrim(rr.local)) = v_loc LIMIT 1) AS legajo,
           (SELECT e.nombre::text FROM public.mayorista_responsables rr JOIN public.empleados e ON e.id = rr.empleado_id
             WHERE rr.lote_id = v_lote AND upper(btrim(rr.local)) = v_loc LIMIT 1) AS nombre
      INTO r FROM public.mayorista_items mi WHERE mi.lote_id = v_lote AND upper(btrim(mi.local)) = v_loc;
    INSERT INTO public.pedidos_venta_estado AS e
      (codigo, fecha, origen, estado, armado_id, lote_id, local, prioridad, obs, legajo, nombre,
       lineas, lineas_ok, unidades, unidades_ok, faltantes, liberado_motivo, liberado_nombre, liberado_at, actualizado_at)
    VALUES (p_codigo, v_ped.fecha, 'repo',
            CASE WHEN r.pend = 0 THEN 'hecho' WHEN r.lineas_ok > 0 THEN 'aceptado' ELSE 'pendiente' END,
            NULL, v_lote, v_loc, NULL, NULL, r.legajo, r.nombre,
            r.lineas, r.lineas_ok, r.unidades, r.unidades_ok, r.faltantes, NULL, NULL, NULL, now())
    ON CONFLICT (codigo) DO UPDATE SET
      fecha = excluded.fecha, origen = excluded.origen, estado = excluded.estado, armado_id = NULL,
      lote_id = excluded.lote_id, local = excluded.local, prioridad = NULL, obs = NULL,
      legajo = excluded.legajo, nombre = excluded.nombre, lineas = excluded.lineas, lineas_ok = excluded.lineas_ok,
      unidades = excluded.unidades, unidades_ok = excluded.unidades_ok, faltantes = excluded.faltantes,
      liberado_motivo = NULL, liberado_nombre = NULL, liberado_at = NULL, actualizado_at = now();
    RETURN;
  END IF;

  -- 3) VTD cerrado por única vez
  IF EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
    INSERT INTO public.pedidos_venta_estado AS e (codigo, fecha, origen, estado, local, actualizado_at)
    VALUES (p_codigo, v_ped.fecha, 'cerrado', 'hecho', v_loc, now())
    ON CONFLICT (codigo) DO UPDATE SET fecha = excluded.fecha, origen = 'cerrado', estado = 'hecho', armado_id = NULL,
      lote_id = NULL, local = excluded.local, legajo = NULL, nombre = NULL, lineas = 0, lineas_ok = 0,
      unidades = 0, unidades_ok = 0, faltantes = 0, liberado_motivo = NULL, liberado_nombre = NULL,
      liberado_at = NULL, actualizado_at = now();
    RETURN;
  END IF;

  DELETE FROM public.pedidos_venta_estado WHERE codigo = p_codigo;
END;
$$;

-- ---- El legajo suelta el armado que tiene en curso ----
CREATE OR REPLACE FUNCTION public.armado_rechazar(p_id uuid, p_motivo text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_arm    public.mayorista_armados%ROWTYPE;
  v_nombre text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No estás autenticado' USING ERRCODE = '28000';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'Contá brevemente por qué no lo podés hacer' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_arm FROM public.mayorista_armados WHERE id = p_id FOR UPDATE;
  IF v_arm.id IS NULL THEN
    RAISE EXCEPTION 'Ese armado ya no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_arm.estado <> 'aceptado' THEN
    RAISE EXCEPTION 'Solo podés soltar un armado que tenés en curso' USING ERRCODE = '55000';
  END IF;
  IF NOT (private.es_admin() OR v_arm.aceptado_por = auth.uid()) THEN
    RAISE EXCEPTION 'Ese armado lo tomó otro legajo' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(nullif(btrim(coalesce(u.legajo::text, '')), ''), u.nombre::text, u.email)
    INTO v_nombre FROM public.usuarios u WHERE u.id = auth.uid();

  -- Si tenía una pausa pedida o corriendo, se cierra (ya no es su tarea)
  UPDATE public.piso_pausas
     SET estado = 'cancelada', hasta = coalesce(hasta, now())
   WHERE armado_id = p_id AND estado IN ('pendiente', 'autorizada') AND hasta IS NULL;

  -- Vuelve a pendiente para todo el piso; se conserva lo escaneado y se resetea el cronómetro
  UPDATE public.mayorista_armados
     SET estado = 'pendiente',
         aceptado_at = NULL, aceptado_por = NULL, aceptado_legajo = NULL, aceptado_nombre = NULL,
         hecho_at = NULL, iniciado_at = NULL,
         crono_estado = 'inactiva', crono_segundos = 0, crono_desde = NULL,
         liberado_motivo = btrim(p_motivo),
         liberado_at = now(),
         liberado_por = auth.uid(),
         liberado_nombre = coalesce(nullif(btrim(v_nombre), ''), 'Legajo'),
         liberado_veces = liberado_veces + 1
   WHERE id = p_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.armado_rechazar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armado_rechazar(uuid, text) TO authenticated;

COMMIT;
