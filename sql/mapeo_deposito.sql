-- ============================================================
-- MAPEO DEPÓSITO (Mayorista)
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- Requiere private.parsear_codigo_barras (sql/equivalencias.sql).
--
-- Se recorre el depósito escaneando los artículos en el orden físico en que
-- están. Cada fila = un artículo (código) en una ubicación (QR escaneado
-- antes), con su posición en el recorrido (orden). Un artículo puede estar
-- en varias ubicaciones, pero una sola vez en cada una.
-- El navegador solo LEE la tabla; se escribe por las funciones de abajo.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.mapeo_deposito (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden           integer NOT NULL,
  codigo          text NOT NULL,               -- artículo (sin color/talle)
  color           text,                        -- del escaneo, informativo
  talle           text,
  codigo_bruto    text NOT NULL,               -- lo que leyó el lector
  ubicacion       text,
  escaneado_por   uuid DEFAULT auth.uid(),
  escaneado_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mapeo_deposito_orden_idx ON public.mapeo_deposito (orden);
-- Versión anterior: el código era único en toda la tabla
ALTER TABLE public.mapeo_deposito DROP CONSTRAINT IF EXISTS mapeo_deposito_codigo_key;
CREATE UNIQUE INDEX IF NOT EXISTS mapeo_deposito_codigo_ubic_uq
  ON public.mapeo_deposito (codigo, coalesce(ubicacion, ''));

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.mapeo.view',     'mayorista', 'mapeo.view',     'Ver mapeo depósito',        950),
  ('mayorista.mapeo.escanear', 'mayorista', 'mapeo.escanear', 'Escanear mapeo depósito',   951),
  ('mayorista.mapeo.borrar',   'mayorista', 'mapeo.borrar',   'Borrar del mapeo depósito', 952),
  ('mayorista.mapeo.gestionar','mayorista', 'mapeo.gestionar','Crear/borrar pasillos y niveles', 953)
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
-- Lista de pasillos / niveles. Su QR impreso dice "UBI:<codigo>".
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mapeo_ubicaciones (
  codigo     text PRIMARY KEY,               -- "A-02" (pasillo A, nivel 2)
  pasillo    integer NOT NULL CHECK (pasillo BETWEEN 1 AND 26),   -- 1 = A … 26 = Z
  nivel      integer NOT NULL CHECK (nivel BETWEEN 1 AND 99),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pasillo, nivel)
);
ALTER TABLE public.mapeo_ubicaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mapeo_ubicaciones FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.mapeo_ubicaciones TO authenticated;

DROP POLICY IF EXISTS mapeo_ubic_ver ON public.mapeo_ubicaciones;
CREATE POLICY mapeo_ubic_ver ON public.mapeo_ubicaciones
  FOR SELECT TO authenticated
  USING (private.tengo_permiso('mayorista.mapeo.view') OR private.tengo_permiso('mayorista.mapeo.escanear'));

DROP POLICY IF EXISTS mapeo_ubic_crear ON public.mapeo_ubicaciones;
CREATE POLICY mapeo_ubic_crear ON public.mapeo_ubicaciones
  FOR INSERT TO authenticated
  WITH CHECK (private.tengo_permiso('mayorista.mapeo.gestionar'));

DROP POLICY IF EXISTS mapeo_ubic_borrar ON public.mapeo_ubicaciones;
CREATE POLICY mapeo_ubic_borrar ON public.mapeo_ubicaciones
  FOR DELETE TO authenticated
  USING (private.tengo_permiso('mayorista.mapeo.gestionar'));

-- ============================================================
-- Escanear un artículo en la ubicación actual (al final del orden).
--   p_accion NULL     : si el artículo no está en ningún lado -> 'nuevo'.
--                       si ya está en esta ubicación          -> 'ya_aca' (no hace nada).
--                       si está en otra(s) ubicación(es)      -> 'ya_mapeado' (no hace nada;
--                       en `otras` van esas ubicaciones para preguntar).
--   p_accion 'mover'  : lo saca de las otras ubicaciones y lo deja en esta -> 'movido'.
--   p_accion 'agregar': lo suma en esta ubicación sin tocar las otras     -> 'agregado'.
-- ============================================================
DROP FUNCTION IF EXISTS public.mapeo_escanear(text, text, boolean);
DROP FUNCTION IF EXISTS public.mapeo_escanear(text, text, text);
CREATE FUNCTION public.mapeo_escanear(p_codigo text, p_ubicacion text, p_accion text DEFAULT NULL)
RETURNS TABLE (estado text, id uuid, orden integer, codigo text, color text, talle text, ubicacion text, otras text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bruto  text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_ubic   text := nullif(upper(trim(coalesce(p_ubicacion, ''))), '');
  v_p      record;
  v_aca    public.mapeo_deposito%ROWTYPE;
  v_otras  text;
  v_orden  integer;
BEGIN
  IF NOT private.tengo_permiso('mayorista.mapeo.escanear') THEN
    RAISE EXCEPTION 'Sin permiso para escanear el mapeo';
  END IF;
  IF v_bruto = '' THEN
    RAISE EXCEPTION 'Código vacío';
  END IF;
  IF coalesce(p_accion, '') NOT IN ('', 'mover', 'agregar') THEN
    RAISE EXCEPTION 'Acción inválida: %', p_accion;
  END IF;

  -- Traduce con las equivalencias de Dragonfish (o el formato CODIGO!COLOR!TALLE)
  SELECT * INTO v_p FROM private.parsear_codigo_barras(v_bruto);
  IF coalesce(v_p.codigo, '') = '' THEN
    RAISE EXCEPTION 'No se pudo leer el código %', v_bruto;
  END IF;

  -- Un escaneo a la vez: el orden no se pisa entre dos lectores
  PERFORM pg_advisory_xact_lock(hashtext('mapeo_deposito'));

  SELECT * INTO v_aca FROM public.mapeo_deposito m
   WHERE m.codigo = v_p.codigo AND coalesce(m.ubicacion, '') = coalesce(v_ubic, '');

  SELECT string_agg(DISTINCT coalesce(m.ubicacion, 'sin ubicación'), ', ') INTO v_otras
    FROM public.mapeo_deposito m
   WHERE m.codigo = v_p.codigo AND coalesce(m.ubicacion, '') <> coalesce(v_ubic, '');

  IF p_accion = 'mover' THEN
    DELETE FROM public.mapeo_deposito m
     WHERE m.codigo = v_p.codigo AND coalesce(m.ubicacion, '') <> coalesce(v_ubic, '');
  ELSIF v_aca.id IS NOT NULL THEN
    RETURN QUERY SELECT 'ya_aca'::text, v_aca.id, v_aca.orden, v_aca.codigo, v_aca.color, v_aca.talle, v_aca.ubicacion, v_otras;
    RETURN;
  ELSIF v_otras IS NOT NULL AND p_accion IS NULL THEN
    RETURN QUERY SELECT 'ya_mapeado'::text, NULL::uuid, NULL::integer, v_p.codigo, v_p.color, v_p.talle, v_ubic, v_otras;
    RETURN;
  END IF;

  -- Mover a una ubicación donde ya estaba: solo se borraron las otras
  IF v_aca.id IS NOT NULL THEN
    RETURN QUERY SELECT 'movido'::text, v_aca.id, v_aca.orden, v_aca.codigo, v_aca.color, v_aca.talle, v_aca.ubicacion, v_otras;
    RETURN;
  END IF;

  SELECT coalesce(max(m.orden), 0) + 1 INTO v_orden FROM public.mapeo_deposito m;

  RETURN QUERY
  INSERT INTO public.mapeo_deposito AS m (orden, codigo, color, talle, codigo_bruto, ubicacion)
  VALUES (v_orden, v_p.codigo, v_p.color, v_p.talle, v_bruto, v_ubic)
  RETURNING (CASE WHEN p_accion = 'mover' THEN 'movido' WHEN p_accion = 'agregar' THEN 'agregado' ELSE 'nuevo' END)::text,
            m.id, m.orden, m.codigo, m.color, m.talle, m.ubicacion, v_otras;
END;
$$;
REVOKE ALL ON FUNCTION public.mapeo_escanear(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapeo_escanear(text, text, text) TO authenticated;

COMMIT;
