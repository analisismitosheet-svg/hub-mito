-- ============================================================================
-- pedidos_venta_estado: quién tiene / hizo cada pedido de venta y su avance
--
-- Aplicado en Supabase (migración pedidos_venta_estado). Idempotente.
--
-- Una fila por pedido con armado o repo, para que Pedidos de venta cargue
-- rápido (lee solo esta tabla, filtrada por la fecha del período) en vez de
-- calcularlo cada vez con armados + ítems + repos.
--   origen   armado | repo | cerrado
--   estado   pendiente | aceptado | hecho   (aceptado = en curso)
--   legajo / nombre   quién lo aceptó o, si no empezó, a quién le toca
-- Regla: si tiene armado, gana el armado (el legajo que lo aceptó); si no y es
-- VTD, la repo de ese día y local con su responsable; si no, VTD cerrado por única vez.
-- Se mantiene sola con triggers (armados, ítems de armados, ítems de repos,
-- responsables, pedidos y pedidos_vtd_cerrados). private.pve_recalcular(codigo)
-- la recalcula a mano si hiciera falta.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pedidos_venta_estado (
  codigo         text PRIMARY KEY,
  fecha          date,
  origen         text NOT NULL CHECK (origen IN ('armado', 'repo', 'cerrado')),
  estado         text NOT NULL CHECK (estado IN ('pendiente', 'aceptado', 'hecho')),
  armado_id      uuid,
  lote_id        uuid,
  local          text,
  prioridad      text,
  obs            text,
  legajo         text,
  nombre         text,
  lineas         integer NOT NULL DEFAULT 0,
  lineas_ok      integer NOT NULL DEFAULT 0,
  unidades       integer NOT NULL DEFAULT 0,
  unidades_ok    integer NOT NULL DEFAULT 0,
  faltantes      integer NOT NULL DEFAULT 0,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pedidos_venta_estado_fecha_idx ON public.pedidos_venta_estado (fecha DESC);

ALTER TABLE public.pedidos_venta_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedidos_venta_estado FROM anon, authenticated;
GRANT SELECT ON public.pedidos_venta_estado TO authenticated;
DROP POLICY IF EXISTS pedidos_venta_estado_ver ON public.pedidos_venta_estado;
CREATE POLICY pedidos_venta_estado_ver ON public.pedidos_venta_estado
  FOR SELECT TO authenticated USING (private.es_admin() OR private.tengo_permiso('pedidos_venta.view'));

-- Índices para que los triggers encuentren rápido los pedidos de una repo
CREATE INDEX IF NOT EXISTS pedidos_venta_vtd_fecha_cliente_idx
  ON public.pedidos_venta (fecha, upper(btrim(cliente))) WHERE motivo = 'VTD';
CREATE INDEX IF NOT EXISTS mayorista_items_lote_local_idx
  ON public.mayorista_items (lote_id, upper(btrim(local)));

-- ---- Recalcular un pedido ----
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

  -- 3) VTD cerrado por única vez
  IF EXISTS (SELECT 1 FROM public.pedidos_vtd_cerrados c WHERE c.codigo = p_codigo) THEN
    INSERT INTO public.pedidos_venta_estado AS e (codigo, fecha, origen, estado, local, actualizado_at)
    VALUES (p_codigo, v_ped.fecha, 'cerrado', 'hecho', v_loc, now())
    ON CONFLICT (codigo) DO UPDATE SET fecha = excluded.fecha, origen = 'cerrado', estado = 'hecho', armado_id = NULL,
      lote_id = NULL, local = excluded.local, legajo = NULL, nombre = NULL, lineas = 0, lineas_ok = 0,
      unidades = 0, unidades_ok = 0, faltantes = 0, actualizado_at = now();
    RETURN;
  END IF;

  DELETE FROM public.pedidos_venta_estado WHERE codigo = p_codigo;
END;
$$;

-- Pedidos VTD de una repo + local (los que hay que recalcular cuando cambia la repo)
CREATE OR REPLACE FUNCTION private.pve_recalcular_repo(p_lote uuid, p_local text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT pv.codigo FROM public.pedidos_venta pv JOIN public.mayorista_lotes l ON l.id = p_lote
     WHERE pv.motivo = 'VTD' AND pv.fecha = l.fecha AND upper(btrim(pv.cliente)) = upper(btrim(p_local))
  LOOP
    PERFORM private.pve_recalcular(c);
  END LOOP;
END;
$$;

-- ---- Triggers ----
CREATE OR REPLACE FUNCTION private.pve_tg_armados() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM private.pve_recalcular(coalesce(NEW.pedido_codigo, OLD.pedido_codigo));
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pve_armados ON public.mayorista_armados;
CREATE TRIGGER pve_armados AFTER INSERT OR UPDATE OR DELETE ON public.mayorista_armados
  FOR EACH ROW EXECUTE FUNCTION private.pve_tg_armados();

-- Ítems de armados: una vez por sentencia y por armado tocado
CREATE OR REPLACE FUNCTION private.pve_tg_armados_items() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c text;
BEGIN
  FOR c IN SELECT DISTINCT a.pedido_codigo FROM nuevos n JOIN public.mayorista_armados a ON a.id = n.armado_id LOOP
    PERFORM private.pve_recalcular(c);
  END LOOP;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pve_armados_items_upd ON public.mayorista_armados_items;
CREATE TRIGGER pve_armados_items_upd AFTER UPDATE ON public.mayorista_armados_items
  REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION private.pve_tg_armados_items();
DROP TRIGGER IF EXISTS pve_armados_items_ins ON public.mayorista_armados_items;
CREATE TRIGGER pve_armados_items_ins AFTER INSERT ON public.mayorista_armados_items
  REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION private.pve_tg_armados_items();

-- Ítems de repos: una vez por sentencia y por (repo, local) tocado
CREATE OR REPLACE FUNCTION private.pve_tg_repo_items() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT n.lote_id, upper(btrim(n.local)) AS local FROM nuevos n LOOP
    PERFORM private.pve_recalcular_repo(r.lote_id, r.local);
  END LOOP;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pve_repo_items_upd ON public.mayorista_items;
CREATE TRIGGER pve_repo_items_upd AFTER UPDATE ON public.mayorista_items
  REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION private.pve_tg_repo_items();
DROP TRIGGER IF EXISTS pve_repo_items_ins ON public.mayorista_items;
CREATE TRIGGER pve_repo_items_ins AFTER INSERT ON public.mayorista_items
  REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION private.pve_tg_repo_items();

-- Responsables de la repo
CREATE OR REPLACE FUNCTION private.pve_tg_responsables() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM private.pve_recalcular_repo(coalesce(NEW.lote_id, OLD.lote_id), coalesce(NEW.local, OLD.local));
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pve_responsables ON public.mayorista_responsables;
CREATE TRIGGER pve_responsables AFTER INSERT OR UPDATE OR DELETE ON public.mayorista_responsables
  FOR EACH ROW EXECUTE FUNCTION private.pve_tg_responsables();

-- Pedidos nuevos o cambiados por el sync (solo los VTD necesitan cálculo)
CREATE OR REPLACE FUNCTION private.pve_tg_pedidos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c text;
BEGIN
  FOR c IN SELECT n.codigo FROM nuevos n WHERE n.motivo = 'VTD' LOOP
    PERFORM private.pve_recalcular(c);
  END LOOP;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pve_pedidos_ins ON public.pedidos_venta;
CREATE TRIGGER pve_pedidos_ins AFTER INSERT ON public.pedidos_venta
  REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION private.pve_tg_pedidos();
DROP TRIGGER IF EXISTS pve_pedidos_upd ON public.pedidos_venta;
CREATE TRIGGER pve_pedidos_upd AFTER UPDATE ON public.pedidos_venta
  REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION private.pve_tg_pedidos();

CREATE OR REPLACE FUNCTION private.pve_tg_cerrados() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM private.pve_recalcular(NEW.codigo);
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS pve_cerrados ON public.pedidos_vtd_cerrados;
CREATE TRIGGER pve_cerrados AFTER INSERT ON public.pedidos_vtd_cerrados
  FOR EACH ROW EXECUTE FUNCTION private.pve_tg_cerrados();

REVOKE ALL ON FUNCTION private.pve_recalcular(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pve_recalcular_repo(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---- Carga inicial ----
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT codigo FROM public.pedidos_venta WHERE motivo = 'VTD'
    UNION SELECT DISTINCT pedido_codigo FROM public.mayorista_armados
  LOOP
    PERFORM private.pve_recalcular(c);
  END LOOP;
END $$;
