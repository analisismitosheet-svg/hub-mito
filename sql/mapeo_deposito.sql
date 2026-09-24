-- ============================================================
-- MAPEO DEPÓSITO (Mayorista)
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- Requiere private.parsear_codigo_barras (sql/equivalencias.sql).
--
-- Se recorre el depósito escaneando los artículos en el orden físico en que
-- están. Cada artículo (código) queda una sola vez, con su posición (orden)
-- y la ubicación que estaba activa al escanearlo (pasillo/estante).
-- El navegador solo LEE la tabla; se escribe por las funciones de abajo.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.mapeo_deposito (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden           integer NOT NULL,
  codigo          text NOT NULL UNIQUE,        -- artículo (sin color/talle)
  color           text,                        -- del escaneo, informativo
  talle           text,
  codigo_bruto    text NOT NULL,               -- lo que leyó el lector
  ubicacion       text,
  escaneado_por   uuid DEFAULT auth.uid(),
  escaneado_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mapeo_deposito_orden_idx ON public.mapeo_deposito (orden);

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.mapeo.view',     'mayorista', 'mapeo.view',     'Ver mapeo depósito',        950),
  ('mayorista.mapeo.escanear', 'mayorista', 'mapeo.escanear', 'Escanear mapeo depósito',   951),
  ('mayorista.mapeo.borrar',   'mayorista', 'mapeo.borrar',   'Borrar del mapeo depósito', 952)
ON CONFLICT (clave) DO NOTHING;

-- Misma definición que en sql/contador_clientes.sql (por si ese no se corrió)
CREATE OR REPLACE FUNCTION private.tengo_permiso(p_clave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT private.es_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = p_clave)
$$;
REVOKE ALL ON FUNCTION private.tengo_permiso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tengo_permiso(text) TO authenticated;

-- ---- RLS: leer con permiso de ver; borrar con permiso de borrar ----
ALTER TABLE public.mapeo_deposito ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mapeo_deposito FROM anon, authenticated;
GRANT SELECT, DELETE ON public.mapeo_deposito TO authenticated;

DROP POLICY IF EXISTS mapeo_deposito_ver ON public.mapeo_deposito;
CREATE POLICY mapeo_deposito_ver ON public.mapeo_deposito
  FOR SELECT TO authenticated
  USING (private.tengo_permiso('mayorista.mapeo.view') OR private.tengo_permiso('mayorista.mapeo.escanear'));

DROP POLICY IF EXISTS mapeo_deposito_borrar ON public.mapeo_deposito;
CREATE POLICY mapeo_deposito_borrar ON public.mapeo_deposito
  FOR DELETE TO authenticated
  USING (private.tengo_permiso('mayorista.mapeo.borrar'));

-- ============================================================
-- Escanear: agrega el artículo al final del orden.
-- Si ya estaba mapeado no lo toca y devuelve estado 'ya_mapeado'
-- (con su posición), salvo p_mover = true: lo pasa al final con la
-- ubicación actual.
-- ============================================================
DROP FUNCTION IF EXISTS public.mapeo_escanear(text, text, boolean);
CREATE FUNCTION public.mapeo_escanear(p_codigo text, p_ubicacion text, p_mover boolean DEFAULT false)
RETURNS TABLE (estado text, id uuid, orden integer, codigo text, color text, talle text, ubicacion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bruto text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_ubic  text := nullif(trim(coalesce(p_ubicacion, '')), '');
  v_p     record;
  v_prev  public.mapeo_deposito%ROWTYPE;
  v_orden integer;
BEGIN
  IF NOT private.tengo_permiso('mayorista.mapeo.escanear') THEN
    RAISE EXCEPTION 'Sin permiso para escanear el mapeo';
  END IF;
  IF v_bruto = '' THEN
    RAISE EXCEPTION 'Código vacío';
  END IF;

  SELECT * INTO v_p FROM private.parsear_codigo_barras(v_bruto);
  IF coalesce(v_p.codigo, '') = '' THEN
    RAISE EXCEPTION 'No se pudo leer el código %', v_bruto;
  END IF;

  -- Un escaneo a la vez: el orden no se pisa entre dos lectores
  PERFORM pg_advisory_xact_lock(hashtext('mapeo_deposito'));

  SELECT * INTO v_prev FROM public.mapeo_deposito m WHERE m.codigo = v_p.codigo;
  IF FOUND AND NOT p_mover THEN
    RETURN QUERY SELECT 'ya_mapeado'::text, v_prev.id, v_prev.orden, v_prev.codigo, v_prev.color, v_prev.talle, v_prev.ubicacion;
    RETURN;
  END IF;

  SELECT coalesce(max(m.orden), 0) + 1 INTO v_orden FROM public.mapeo_deposito m;

  IF v_prev.id IS NOT NULL THEN
    UPDATE public.mapeo_deposito m
       SET orden = v_orden, color = v_p.color, talle = v_p.talle, codigo_bruto = v_bruto,
           ubicacion = v_ubic, escaneado_por = auth.uid(), escaneado_at = now()
     WHERE m.id = v_prev.id;
    RETURN QUERY SELECT 'movido'::text, v_prev.id, v_orden, v_p.codigo, v_p.color, v_p.talle, v_ubic;
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.mapeo_deposito AS m (orden, codigo, color, talle, codigo_bruto, ubicacion)
  VALUES (v_orden, v_p.codigo, v_p.color, v_p.talle, v_bruto, v_ubic)
  RETURNING 'nuevo'::text, m.id, m.orden, m.codigo, m.color, m.talle, m.ubicacion;
END;
$$;
REVOKE ALL ON FUNCTION public.mapeo_escanear(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapeo_escanear(text, text, boolean) TO authenticated;

COMMIT;
