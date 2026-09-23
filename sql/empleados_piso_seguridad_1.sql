-- =====================================================
-- PARTE 1 (aditiva, no rompe nada) — SEGURIDAD DEL INGRESO DE EMPLEADOS A PISO  (sigue a empleados_piso.sql)
--
-- 1. escanear_codigo() / deshacer_escaneo(): el escaneo se hace en la base,
--    de forma atómica (+1 real aunque lleguen dos escaneos juntos) y solo
--    sobre los (lote, local) asignados. El empleado ya NO puede hacer UPDATE
--    directo sobre mayorista_items (antes podía cambiar cantidad, código, etc.).
-- 2. Trigger: "deshacer" el último escaneo de un ítem completo ya no lo
--    vuelve a 0 (solo se resetea cuando el admin desmarca sin tocar escaneadas).
-- 3. mayorista_lotes: el empleado puede leer el nombre de SUS lotes.
-- 4. empleados: la nómina completa (DNI, CUIL, domicilio, etc.) solo la ve y
--    edita RR. HH. / admin. El resto usa la vista empleados_basico
--    (id, legajo, nombre, activo, estado_legajo, lugar), solo si tiene un
--    permiso que la necesite, y cada empleado de piso ve únicamente su fila.
--
-- Idempotente. Todo en una transacción.
-- =====================================================

-- PARTE 1: se puede aplicar en cualquier momento. Agrega funciones, vista y permiso de lotes.
-- La PARTE 2 (cierre) se aplica DESPUÉS de publicar el hub que usa empleados_basico y escanear_codigo.

BEGIN;


-- -----------------------------------------------------
-- 2. Trigger escaneadas <-> estado
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.mayorista_items_sync_escaneadas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'hecho' THEN
    NEW.escaneadas := GREATEST(coalesce(NEW.cantidad, 0), coalesce(NEW.escaneadas, 0));
  ELSIF TG_OP = 'UPDATE'
        AND OLD.estado = 'hecho'
        AND NEW.estado = 'pendiente'
        AND NEW.escaneadas IS NOT DISTINCT FROM OLD.escaneadas THEN
    -- El admin desmarcó (no tocó escaneadas): se vuelve a escanear desde cero.
    -- Si escaneadas cambió (deshacer del piso), se respeta el valor nuevo.
    NEW.escaneadas := 0;
  END IF;

  IF coalesce(NEW.escaneadas, 0) < 0 THEN
    NEW.escaneadas := 0;
  ELSIF coalesce(NEW.escaneadas, 0) > coalesce(NEW.cantidad, 0) THEN
    NEW.escaneadas := coalesce(NEW.cantidad, 0);
  END IF;
  RETURN NEW;
END;
$$;


-- -----------------------------------------------------
-- 1. Escaneo atómico
-- -----------------------------------------------------
CREATE OR REPLACE FUNCTION private.puede_escanear(p_lote uuid, p_local text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.es_admin()
      OR private.tiene_permiso('mayorista.mark')
      OR EXISTS (
        SELECT 1 FROM public.mayorista_responsables mr
        WHERE mr.lote_id = p_lote
          AND upper(coalesce(mr.local, '')) = upper(coalesce(p_local, ''))
          AND mr.empleado_id = private.mi_empleado_id()
      );
$$;

-- Suma UNA unidad al primer ítem pendiente con ese código en ese (lote, local).
-- Lo elige la base, con bloqueo de fila: dos escaneos simultáneos cuentan dos.
CREATE OR REPLACE FUNCTION public.escanear_codigo(p_lote uuid, p_local text, p_codigo text)
RETURNS TABLE (item_id uuid, item_escaneadas integer, item_cantidad integer, item_estado text, item_codigo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_id uuid;
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

-- Resta UNA unidad a un ítem (botón "deshacer" del piso).
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

REVOKE ALL ON FUNCTION private.puede_escanear(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.escanear_codigo(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deshacer_escaneo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escanear_codigo(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deshacer_escaneo(uuid) TO authenticated;

-- -----------------------------------------------------
-- 3. El empleado lee el nombre de SUS lotes
-- -----------------------------------------------------
DROP POLICY IF EXISTS "mayorista_lotes_piso" ON public.mayorista_lotes;
CREATE POLICY "mayorista_lotes_piso" ON public.mayorista_lotes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mayorista_responsables mr
      WHERE mr.lote_id = mayorista_lotes.id
        AND mr.empleado_id = private.mi_empleado_id()
    )
  );


-- -----------------------------------------------------
-- 4. Vista mínima de la nómina
-- -----------------------------------------------------
-- Vista con lo mínimo para los selectores (responsables, novedades, estadísticas...).
-- Corre con los permisos del dueño (no aplica la RLS de empleados) y filtra acá:
-- solo usuarios con un permiso que la necesite, o el propio empleado (su fila).
-- Los "(SELECT ...)" hacen que cada chequeo se evalúe una vez y no por fila.
-- Las funciones de una vista se ejecutan con los permisos de quien consulta, y
-- "authenticated" no tiene acceso al esquema private: por eso estos dos puentes.
CREATE OR REPLACE FUNCTION public.empleados_basico_ve_todos()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.es_admin()
      OR private.tiene_permiso('rrhh.empleados.view')
      OR private.tiene_permiso('rrhh.novedades.view')
      OR private.tiene_permiso('rrhh.novedades.create')
      OR private.tiene_permiso('deposito.view')
      OR private.tiene_permiso('mayorista.view')
      OR private.tiene_permiso('mayorista.estadisticas.view')
      OR private.tiene_permiso('mayorista.facturacion.view');
$$;

CREATE OR REPLACE FUNCTION public.mi_empleado_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.mi_empleado_id();
$$;

REVOKE ALL ON FUNCTION public.empleados_basico_ve_todos() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mi_empleado_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empleados_basico_ve_todos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mi_empleado_id() TO authenticated;

DROP VIEW IF EXISTS public.empleados_basico;
CREATE VIEW public.empleados_basico WITH (security_barrier = true) AS
SELECT e.id, e.legajo, e.nombre, e.activo, e.estado_legajo, e.lugar
FROM public.empleados e
WHERE (SELECT public.empleados_basico_ve_todos())
   OR e.id = (SELECT public.mi_empleado_id());

REVOKE ALL ON public.empleados_basico FROM PUBLIC, anon;
GRANT SELECT ON public.empleados_basico TO authenticated;

COMMIT;
