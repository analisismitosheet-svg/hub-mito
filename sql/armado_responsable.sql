-- ============================================================================
-- Armado de pedidos: lo toma el responsable del local en Repos Mayorista
--
-- Aplicado en Supabase (migración armado_responsable). Idempotente.
--
-- Cuando el mayorista pide un armado, si el CLIENTE del pedido es un local
-- (mismo código que en la repo: GPAZD, VCPD, CFR4…; también por sinónimos de
-- locales_sinonimos) que tiene responsable asignado en la repo más reciente
-- donde ese local tiene uno, el armado queda ASIGNADO a ese legajo:
--   * solo le aparece y le suena a él (Mi repo, campana y aviso push),
--   * solo él lo puede aceptar (el mayorista/admin también, para destrabarlo).
-- Si el cliente no es un local con responsable, sigue como antes: lo ve todo el
-- piso y el primero que acepta se lo queda.
-- ============================================================================

ALTER TABLE public.mayorista_armados
  ADD COLUMN IF NOT EXISTS asignado_empleado_id uuid,
  ADD COLUMN IF NOT EXISTS asignado_legajo      text,
  ADD COLUMN IF NOT EXISTS asignado_nombre      text,
  ADD COLUMN IF NOT EXISTS asignado_local       text;

-- Responsable del local en la repo más reciente donde ese local tiene uno
CREATE OR REPLACE FUNCTION private.responsable_de_local(p_local text)
RETURNS TABLE(empleado_id uuid, legajo text, nombre text, local text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cod AS (
    SELECT upper(btrim(p_local)) AS c
    UNION
    SELECT upper(s2.nombre)
      FROM public.locales_sinonimos s1
      JOIN public.locales_sinonimos s2 ON s2.grupo = s1.grupo
     WHERE upper(s1.nombre) = upper(btrim(p_local))
  )
  SELECT r.empleado_id, e.legajo::text, e.nombre::text, r.local
    FROM public.mayorista_responsables r
    JOIN public.mayorista_lotes l ON l.id = r.lote_id
    JOIN public.empleados e ON e.id = r.empleado_id  -- la nómina (empleados_basico filtra por usuario)
   WHERE r.empleado_id IS NOT NULL
     AND upper(btrim(r.local)) IN (SELECT c FROM cod)
   ORDER BY coalesce(l.fecha, l.created_at::date) DESC, l.created_at DESC
   LIMIT 1
$$;

-- Al crear el armado se le asigna el responsable (pedir_armado no cambia)
CREATE OR REPLACE FUNCTION private.armado_asignar_responsable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  IF NEW.asignado_empleado_id IS NULL AND coalesce(NEW.cliente, '') <> '' THEN
    SELECT * INTO r FROM private.responsable_de_local(NEW.cliente);
    IF r.empleado_id IS NOT NULL THEN
      NEW.asignado_empleado_id := r.empleado_id;
      NEW.asignado_legajo := r.legajo;
      NEW.asignado_nombre := r.nombre;
      NEW.asignado_local := r.local;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mayorista_armados_responsable ON public.mayorista_armados;
CREATE TRIGGER mayorista_armados_responsable
  BEFORE INSERT ON public.mayorista_armados
  FOR EACH ROW EXECUTE FUNCTION private.armado_asignar_responsable();

-- Aceptar: si está asignado, solo el responsable (o el mayorista / admin)
CREATE OR REPLACE FUNCTION public.armado_aceptar(
  p_id     uuid,
  p_legajo text DEFAULT NULL,
  p_nombre text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n      integer := 0;
  v_asig   text;
  v_nombre text;
  v_mio    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (
    private.tengo_permiso('pedidos_venta.view')
    OR private.tengo_permiso('mayorista.repos_piso')
  ) THEN
    RAISE EXCEPTION 'Sin permiso para tomar armados' USING ERRCODE = '42501';
  END IF;

  SELECT asignado_legajo, asignado_nombre INTO v_asig, v_nombre FROM public.mayorista_armados WHERE id = p_id;
  IF v_asig IS NOT NULL AND NOT (private.es_admin() OR private.tengo_permiso('pedidos_venta.view')) THEN
    SELECT btrim(coalesce(u.legajo::text, '')) INTO v_mio FROM public.usuarios u WHERE u.id = auth.uid();
    IF coalesce(v_mio, '') <> btrim(v_asig) THEN
      RAISE EXCEPTION 'Este armado es de %, el responsable del local', coalesce(v_nombre, 'otro legajo') USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.mayorista_armados
     SET estado = 'aceptado',
         aceptado_at = now(),
         aceptado_por = auth.uid(),
         aceptado_legajo = nullif(trim(coalesce(p_legajo, '')), ''),
         aceptado_nombre = nullif(trim(coalesce(p_nombre, '')), '')
   WHERE id = p_id
     AND estado = 'pendiente';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION private.responsable_de_local(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.armado_asignar_responsable() FROM PUBLIC, anon;

-- Los pendientes que ya estaban también quedan asignados
UPDATE public.mayorista_armados a
   SET asignado_empleado_id = r.empleado_id, asignado_legajo = r.legajo,
       asignado_nombre = r.nombre, asignado_local = r.local
  FROM public.mayorista_armados a2
  CROSS JOIN LATERAL private.responsable_de_local(a2.cliente) r
 WHERE a.id = a2.id AND a.estado = 'pendiente' AND a.asignado_empleado_id IS NULL AND r.empleado_id IS NOT NULL;
