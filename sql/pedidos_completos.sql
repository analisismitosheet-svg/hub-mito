-- ============================================================================
-- Pedidos completos: no se vuelven a pedir (salvo admin) + cierre VTD/REP hasta ayer
--
-- Aplicado en Supabase (migración pedidos_completos). Idempotente.
--
-- 1) Un pedido completo (todo en verde: pedidos_venta_estado.estado = 'hecho' y
--    sin faltantes) no se puede volver a pedir a armar. Solo el admin puede.
--    pedir_armado lo saltea (cuenta como descartado).
-- 2) pedidos_vtd_cerrados ahora vale para cualquier motivo (no solo VTD) y manda
--    antes que la repo: el pedido queda en verde, todos sus renglones hechos.
--    Por única vez (09/10/2026): VTD y REP con fecha hasta ayer (08/10/2026).
-- ============================================================================

-- ---- 1) pedir_armado: saltea los completos (menos para el admin) ----
CREATE OR REPLACE FUNCTION public.pedir_armado(
  p_codigos   text[],
  p_prioridad text DEFAULT 'normal',
  p_obs       text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cod   text;
  v_ped   public.pedidos_venta%ROWTYPE;
  v_id    uuid;
  v_n     integer := 0;
  v_admin boolean := private.es_admin();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Sin permiso para pedir el armado de pedidos' USING ERRCODE = '42501';
  END IF;
  IF p_prioridad IS NULL OR p_prioridad NOT IN ('urgente', 'normal', 'baja') THEN
    RAISE EXCEPTION 'Prioridad inválida: urgente, normal o baja' USING ERRCODE = '22023';
  END IF;
  IF p_codigos IS NULL OR coalesce(array_length(p_codigos, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Ningún pedido seleccionado' USING ERRCODE = '22023';
  END IF;
  IF coalesce(array_length(p_codigos, 1), 0) > 100 THEN
    RAISE EXCEPTION 'Máximo 100 pedidos por pedido de armado' USING ERRCODE = '22023';
  END IF;

  FOREACH v_cod IN ARRAY p_codigos LOOP
    SELECT * INTO v_ped FROM public.pedidos_venta WHERE codigo = trim(v_cod);
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_ped.anulado THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.pedidos_venta_items i
       WHERE i.codigo = v_ped.codigo AND coalesce(round(i.cantidad), 0) > 0
    ) THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.mayorista_armados a
       WHERE a.pedido_codigo = v_ped.codigo AND a.estado IN ('pendiente', 'aceptado')
    ) THEN
      CONTINUE;
    END IF;
    -- Completo (todo en verde): solo el admin lo puede volver a pedir
    IF NOT v_admin AND EXISTS (
      SELECT 1 FROM public.pedidos_venta_estado e
       WHERE e.codigo = v_ped.codigo AND e.estado = 'hecho' AND e.faltantes = 0
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.mayorista_armados
      (pedido_codigo, pedido_numero, cliente, cliente_nombre, prioridad, obs, creado_por)
    VALUES
      (v_ped.codigo, v_ped.numero, v_ped.cliente, v_ped.cliente_nombre,
       p_prioridad, nullif(trim(coalesce(p_obs, '')), ''), auth.uid())
    RETURNING id INTO v_id;

    INSERT INTO public.mayorista_armados_items
      (armado_id, linea, articulo, descripcion, color, talle, cantidad)
    SELECT v_id, i.linea,
           nullif(upper(regexp_replace(coalesce(i.articulo, ''), '\s', '', 'g')), ''),
           i.descripcion, i.color, i.talle,
           greatest(round(i.cantidad)::integer, 0)
      FROM public.pedidos_venta_items i
     WHERE i.codigo = v_ped.codigo
       AND coalesce(round(i.cantidad), 0) > 0
     ORDER BY i.linea;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

-- ---- 2) Cerrados: cualquier motivo, y antes que la repo ----
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
  v_loc := upper(btrim(coalesce(v_ped.cliente, '')));

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
       lineas, lineas_ok, unidades, unidades_ok, faltantes, actualizado_at)
    VALUES (p_codigo, v_ped.fecha, 'armado', v_arm.estado, v_arm.id, NULL, v_arm.asignado_local, v_arm.prioridad, v_arm.obs,
            coalesce(v_arm.aceptado_legajo, v_arm.asignado_legajo), coalesce(v_arm.aceptado_nombre, v_arm.asignado_nombre),
            r.lineas, r.lineas_ok, r.unidades, r.unidades_ok, v_arm.faltantes, now())
    ON CONFLICT (codigo) DO UPDATE SET
      fecha = excluded.fecha, origen = excluded.origen, estado = excluded.estado, armado_id = excluded.armado_id,
      lote_id = NULL, local = excluded.local, prioridad = excluded.prioridad, obs = excluded.obs,
      legajo = excluded.legajo, nombre = excluded.nombre, lineas = excluded.lineas, lineas_ok = excluded.lineas_ok,
      unidades = excluded.unidades, unidades_ok = excluded.unidades_ok, faltantes = excluded.faltantes, actualizado_at = now();
    RETURN;
  END IF;

  -- 2) Cerrado (cualquier motivo): completo, en verde
  IF EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
    INSERT INTO public.pedidos_venta_estado AS e (codigo, fecha, origen, estado, local, actualizado_at)
    VALUES (p_codigo, v_ped.fecha, 'cerrado', 'hecho', v_loc, now())
    ON CONFLICT (codigo) DO UPDATE SET fecha = excluded.fecha, origen = 'cerrado', estado = 'hecho', armado_id = NULL,
      lote_id = NULL, local = excluded.local, legajo = NULL, nombre = NULL, lineas = 0, lineas_ok = 0,
      unidades = 0, unidades_ok = 0, faltantes = 0, actualizado_at = now();
    RETURN;
  END IF;

  IF v_ped.motivo IS DISTINCT FROM 'VTD' THEN
    DELETE FROM public.pedidos_venta_estado WHERE codigo = p_codigo;
    RETURN;
  END IF;

  -- 3) VTD: la repo de ese día que tiene ese local
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
       lineas, lineas_ok, unidades, unidades_ok, faltantes, actualizado_at)
    VALUES (p_codigo, v_ped.fecha, 'repo',
            CASE WHEN r.pend = 0 THEN 'hecho' WHEN r.lineas_ok > 0 THEN 'aceptado' ELSE 'pendiente' END,
            NULL, v_lote, v_loc, NULL, NULL, r.legajo, r.nombre,
            r.lineas, r.lineas_ok, r.unidades, r.unidades_ok, r.faltantes, now())
    ON CONFLICT (codigo) DO UPDATE SET
      fecha = excluded.fecha, origen = excluded.origen, estado = excluded.estado, armado_id = NULL,
      lote_id = excluded.lote_id, local = excluded.local, prioridad = NULL, obs = NULL,
      legajo = excluded.legajo, nombre = excluded.nombre, lineas = excluded.lineas, lineas_ok = excluded.lineas_ok,
      unidades = excluded.unidades, unidades_ok = excluded.unidades_ok, faltantes = excluded.faltantes, actualizado_at = now();
    RETURN;
  END IF;

  DELETE FROM public.pedidos_venta_estado WHERE codigo = p_codigo;
END;
$$;

CREATE OR REPLACE FUNCTION public.estado_lineas_pedido(p_codigo text)
RETURNS TABLE(linea integer, enviadas integer, estado text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_arm  uuid;
  v_ped  public.pedidos_venta%ROWTYPE;
  v_lote uuid;
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('pedidos_venta.view')) THEN
    RETURN;
  END IF;

  SELECT * INTO v_ped FROM public.pedidos_venta WHERE codigo = p_codigo;
  IF v_ped.codigo IS NULL THEN RETURN; END IF;

  SELECT a.id INTO v_arm FROM public.mayorista_armados a
   WHERE a.pedido_codigo = p_codigo ORDER BY a.creado_at DESC LIMIT 1;
  IF v_arm IS NOT NULL THEN
    RETURN QUERY
    SELECT ai.linea, least(coalesce(ai.escaneadas, 0), ai.cantidad)::integer, ai.estado::text
      FROM public.mayorista_armados_items ai WHERE ai.armado_id = v_arm;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
    RETURN QUERY
    SELECT i.linea, round(i.cantidad)::integer, 'hecho'::text
      FROM public.pedidos_venta_items i WHERE i.codigo = p_codigo;
    RETURN;
  END IF;

  IF v_ped.motivo IS DISTINCT FROM 'VTD' THEN RETURN; END IF;

  SELECT l.id INTO v_lote FROM public.mayorista_lotes l
   WHERE l.fecha = v_ped.fecha
     AND EXISTS (SELECT 1 FROM public.mayorista_items mi WHERE mi.lote_id = l.id AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente)))
   ORDER BY l.created_at DESC LIMIT 1;
  IF v_lote IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH m AS (
    SELECT upper(btrim(mi.codigo)) AS art, upper(btrim(coalesce(mi.color, ''))) AS col, upper(btrim(coalesce(mi.talle, ''))) AS tal,
           sum(mi.cantidad) AS cant,
           sum(CASE WHEN mi.estado = 'hecho' THEN mi.cantidad ELSE least(coalesce(mi.escaneadas, 0), mi.cantidad) END) AS env,
           bool_and(mi.estado <> 'pendiente') AS cerrado
      FROM public.mayorista_items mi
     WHERE mi.lote_id = v_lote AND upper(btrim(mi.local)) = upper(btrim(v_ped.cliente))
     GROUP BY 1, 2, 3
  )
  SELECT i.linea,
         least(coalesce(m.env, 0), round(i.cantidad))::integer,
         CASE WHEN m.art IS NULL THEN 'pendiente'
              WHEN m.env >= m.cant THEN 'hecho'
              WHEN m.cerrado THEN 'faltante'
              ELSE 'pendiente' END
    FROM public.pedidos_venta_items i
    LEFT JOIN m ON m.art = upper(btrim(i.articulo)) AND m.col = upper(btrim(coalesce(i.color, ''))) AND m.tal = upper(btrim(coalesce(i.talle, '')))
   WHERE i.codigo = p_codigo;
END;
$$;

-- ---- Por única vez (09/10/2026): VTD y REP hasta ayer quedan completos ----
INSERT INTO public.pedidos_vtd_cerrados (codigo, motivo)
SELECT pv.codigo, 'cierre_vtd_rep_2026_10_09'
  FROM public.pedidos_venta pv
 WHERE pv.motivo IN ('VTD', 'REP') AND pv.fecha <= DATE '2026-10-08' AND NOT pv.anulado
   AND NOT EXISTS (SELECT 1 FROM public.mayorista_armados a WHERE a.pedido_codigo = pv.codigo AND a.estado <> 'hecho')
   -- los que ya están completos (ej. repos con quién las hizo) quedan como están
   AND NOT EXISTS (SELECT 1 FROM public.pedidos_venta_estado e WHERE e.codigo = pv.codigo AND e.estado = 'hecho')
ON CONFLICT (codigo) DO NOTHING;
