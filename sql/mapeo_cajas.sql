-- ============================================================
-- MAPEO DE CAJAS (Depósito)
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- Requiere private.parsear_codigo_barras (sql/equivalencias.sql) y
-- private.tengo_permiso (sql/mapeo_deposito.sql).
--
-- Igual que el Mapeo depósito del Mayorista, pero en vez de ubicaciones
-- (pasillo / nivel) el depósito guarda la mercadería en CAJAS NUMERADAS.
-- Se escanea (o se tipea) el número de caja y después los artículos que
-- tiene adentro. Cada fila = un artículo (código) en una caja, con su
-- posición en el recorrido (orden). Un artículo puede estar en varias
-- cajas, pero una sola vez en cada una.
-- El navegador solo LEE la tabla; se escribe por la función de abajo.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.mapeo_cajas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden           integer NOT NULL,
  caja            integer NOT NULL CHECK (caja BETWEEN 1 AND 999999),
  codigo          text NOT NULL,               -- artículo (sin color/talle)
  color           text,                        -- del escaneo, informativo
  talle           text,
  codigo_bruto    text NOT NULL,               -- lo que leyó el lector
  escaneado_por   uuid DEFAULT auth.uid(),
  escaneado_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo, caja)
);
CREATE INDEX IF NOT EXISTS mapeo_cajas_orden_idx ON public.mapeo_cajas (orden);
CREATE INDEX IF NOT EXISTS mapeo_cajas_caja_idx ON public.mapeo_cajas (caja);

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('deposito.cajas.view',      'deposito', 'cajas.view',      'Ver mapeo de cajas',          830),
  ('deposito.cajas.escanear',  'deposito', 'cajas.escanear',  'Escanear mapeo de cajas',     831),
  ('deposito.cajas.borrar',    'deposito', 'cajas.borrar',    'Borrar del mapeo de cajas',   832),
  ('deposito.cajas.gestionar', 'deposito', 'cajas.gestionar', 'Crear/borrar números de caja', 833)
ON CONFLICT (clave) DO NOTHING;

-- El rol Depósito ve el mapeo y escanea (borrar y gestionar quedan para el admin
-- o para quien se le dé a mano).
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'deposito', p.clave
FROM (VALUES
  ('deposito.cajas.view'),
  ('deposito.cajas.escanear')
) AS p(clave)
WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = 'deposito' AND permiso_clave = p.clave);

-- ---- RLS: leer con permiso de ver; borrar con permiso de borrar ----
ALTER TABLE public.mapeo_cajas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mapeo_cajas FROM anon, authenticated;
GRANT SELECT, DELETE ON public.mapeo_cajas TO authenticated;

DROP POLICY IF EXISTS mapeo_cajas_ver ON public.mapeo_cajas;
CREATE POLICY mapeo_cajas_ver ON public.mapeo_cajas
  FOR SELECT TO authenticated
  USING (private.tengo_permiso('deposito.cajas.view') OR private.tengo_permiso('deposito.cajas.escanear'));

DROP POLICY IF EXISTS mapeo_cajas_borrar ON public.mapeo_cajas;
CREATE POLICY mapeo_cajas_borrar ON public.mapeo_cajas
  FOR DELETE TO authenticated
  USING (private.tengo_permiso('deposito.cajas.borrar'));

-- ============================================================
-- Lista de cajas numeradas. Su QR impreso dice "CAJA:<numero>".
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mapeo_cajas_lista (
  numero     integer PRIMARY KEY CHECK (numero BETWEEN 1 AND 999999),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mapeo_cajas_lista ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mapeo_cajas_lista FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.mapeo_cajas_lista TO authenticated;

DROP POLICY IF EXISTS mapeo_cajas_lista_ver ON public.mapeo_cajas_lista;
CREATE POLICY mapeo_cajas_lista_ver ON public.mapeo_cajas_lista
  FOR SELECT TO authenticated
  USING (private.tengo_permiso('deposito.cajas.view') OR private.tengo_permiso('deposito.cajas.escanear'));

DROP POLICY IF EXISTS mapeo_cajas_lista_crear ON public.mapeo_cajas_lista;
CREATE POLICY mapeo_cajas_lista_crear ON public.mapeo_cajas_lista
  FOR INSERT TO authenticated
  WITH CHECK (private.tengo_permiso('deposito.cajas.gestionar'));

DROP POLICY IF EXISTS mapeo_cajas_lista_borrar ON public.mapeo_cajas_lista;
CREATE POLICY mapeo_cajas_lista_borrar ON public.mapeo_cajas_lista
  FOR DELETE TO authenticated
  USING (private.tengo_permiso('deposito.cajas.gestionar'));

-- ============================================================
-- Escanear un artículo en la caja actual (al final del orden).
--   p_accion NULL     : si el artículo no está en ninguna caja -> 'nuevo'.
--                       si ya está en esta caja                -> 'ya_aca' (no hace nada).
--                       si está en otra(s) caja(s)             -> 'ya_mapeado' (no hace nada;
--                       en `otras` van esas cajas para preguntar).
--   p_accion 'mover'  : lo saca de las otras cajas y lo deja en esta -> 'movido'.
--                       p_sacar_de: de cuáles sacarlo (NULL = de todas las otras).
--   p_accion 'agregar': lo suma en esta caja sin tocar las otras     -> 'agregado'.
-- ============================================================
DROP FUNCTION IF EXISTS public.mapeo_cajas_escanear(text, integer, text, integer[]);
CREATE FUNCTION public.mapeo_cajas_escanear(p_codigo text, p_caja integer, p_accion text DEFAULT NULL, p_sacar_de integer[] DEFAULT NULL)
RETURNS TABLE (estado text, id uuid, orden integer, codigo text, color text, talle text, caja integer, otras integer[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bruto  text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_p      record;
  v_aca    public.mapeo_cajas%ROWTYPE;
  v_otras  integer[];
  v_orden  integer;
BEGIN
  IF NOT private.tengo_permiso('deposito.cajas.escanear') THEN
    RAISE EXCEPTION 'Sin permiso para escanear el mapeo de cajas';
  END IF;
  IF p_caja IS NULL OR p_caja < 1 THEN
    RAISE EXCEPTION 'Número de caja inválido';
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
  PERFORM pg_advisory_xact_lock(hashtext('mapeo_cajas'));

  SELECT * INTO v_aca FROM public.mapeo_cajas m
   WHERE m.codigo = v_p.codigo AND m.caja = p_caja;

  SELECT array_agg(DISTINCT m.caja ORDER BY m.caja) INTO v_otras
    FROM public.mapeo_cajas m
   WHERE m.codigo = v_p.codigo AND m.caja <> p_caja;

  IF p_accion = 'mover' THEN
    DELETE FROM public.mapeo_cajas m
     WHERE m.codigo = v_p.codigo AND m.caja <> p_caja
       AND (p_sacar_de IS NULL OR m.caja = ANY (p_sacar_de));
  ELSIF v_aca.id IS NOT NULL THEN
    RETURN QUERY SELECT 'ya_aca'::text, v_aca.id, v_aca.orden, v_aca.codigo, v_aca.color, v_aca.talle, v_aca.caja, v_otras;
    RETURN;
  ELSIF v_otras IS NOT NULL AND p_accion IS NULL THEN
    RETURN QUERY SELECT 'ya_mapeado'::text, NULL::uuid, NULL::integer, v_p.codigo, v_p.color, v_p.talle, p_caja, v_otras;
    RETURN;
  END IF;

  -- Mover a una caja donde ya estaba: solo se borraron las otras
  IF v_aca.id IS NOT NULL THEN
    RETURN QUERY SELECT 'movido'::text, v_aca.id, v_aca.orden, v_aca.codigo, v_aca.color, v_aca.talle, v_aca.caja, v_otras;
    RETURN;
  END IF;

  SELECT coalesce(max(m.orden), 0) + 1 INTO v_orden FROM public.mapeo_cajas m;

  RETURN QUERY
  INSERT INTO public.mapeo_cajas AS m (orden, caja, codigo, color, talle, codigo_bruto)
  VALUES (v_orden, p_caja, v_p.codigo, v_p.color, v_p.talle, v_bruto)
  RETURNING (CASE WHEN p_accion = 'mover' THEN 'movido' WHEN p_accion = 'agregar' THEN 'agregado' ELSE 'nuevo' END)::text,
            m.id, m.orden, m.codigo, m.color, m.talle, m.caja, v_otras;
END;
$$;
REVOKE ALL ON FUNCTION public.mapeo_cajas_escanear(text, integer, text, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapeo_cajas_escanear(text, integer, text, integer[]) TO authenticated;

COMMIT;
