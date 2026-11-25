-- ============================================================
-- MAPEO DE BULTOS EN POLO 52 (25/11/2026, lo pidió el usuario)
-- Ejecutar en Supabase SQL Editor. Idempotente.
-- Requiere private.tengo_permiso (sql/mapeo_deposito.sql).
--
-- Polo 52 guarda los bultos que llegan en POSICIONES (palets). Se escanea
-- la posición (QR «POLO:<codigo>») y después el QR de cada bulto
-- (ORIGEN-NRO-DESTINO de Transporte). El hub busca en DRAGONFISH_POLO52
-- (MTRANS/DETMTRANS, ingreso de ese origen y ese N° de remito) los
-- artículos del remito y los deja en esa posición, con color, talle y
-- cantidad. Si el remito vino en varios bultos (1/2, 2/2), Dragon no dice
-- qué va en cada uno: cada bulto lleva el remito ENTERO (bultos_total
-- avisa que puede estar repartido).
-- Es un depósito aparte: no comparte tablas con mapeo_deposito (MITO) ni
-- mapeo_cajas (INDO).
-- El navegador LEE las tablas; escribe por las funciones de abajo.
-- ============================================================

BEGIN;

-- ---- Posiciones (palets). Su QR impreso dice "POLO:<codigo>" ----
CREATE TABLE IF NOT EXISTS public.polo_posiciones (
  codigo      text PRIMARY KEY CHECK (codigo ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  creada_por  uuid DEFAULT auth.uid()
);

-- ---- Un bulto en una posición (un bulto está en una sola posición) ----
CREATE TABLE IF NOT EXISTS public.polo_mapeo_bultos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posicion       text NOT NULL REFERENCES public.polo_posiciones(codigo) ON UPDATE CASCADE,
  bulto          text NOT NULL UNIQUE,      -- ORIGEN-NRO-DESTINO normalizado
  origen         text NOT NULL,             -- base de origen (como vino en el QR o la de Dragon)
  nro            text NOT NULL,             -- número interno del QR (ej. 16050(1/2))
  remitos        text[] NOT NULL DEFAULT '{}', -- «R 0001-00016050» de Dragon
  bulto_n        integer,                   -- 1 de (1/2)
  bultos_total   integer,                   -- 2 de (1/2)
  unidades       numeric NOT NULL DEFAULT 0,
  escaneado_por  uuid DEFAULT auth.uid(),
  escaneado_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS polo_mapeo_bultos_pos_idx ON public.polo_mapeo_bultos (posicion);

-- ---- Artículos del bulto (los del remito, tal cual Dragon) ----
CREATE TABLE IF NOT EXISTS public.polo_mapeo_items (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bulto_id     uuid NOT NULL REFERENCES public.polo_mapeo_bultos(id) ON DELETE CASCADE,
  remito       text,
  articulo     text NOT NULL,
  descripcion  text,
  color        text,
  color_nombre text,
  talle        text,
  cantidad     numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS polo_mapeo_items_bulto_idx ON public.polo_mapeo_items (bulto_id);
CREATE INDEX IF NOT EXISTS polo_mapeo_items_art_idx ON public.polo_mapeo_items (articulo);

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('polo52.mapeo.view',      'polo52', 'mapeo.view',      'Ver mapeo de bultos de Polo 52',            845),
  ('polo52.mapeo.escanear',  'polo52', 'mapeo.escanear',  'Escanear bultos en posiciones de Polo 52',  846),
  ('polo52.mapeo.gestionar', 'polo52', 'mapeo.gestionar', 'Crear/borrar posiciones y sacar bultos',    847)
ON CONFLICT (clave) DO NOTHING;

-- El rol polo52 tiene todo el mapeo de su depósito
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'polo52', p.clave
  FROM (VALUES ('polo52.mapeo.view'), ('polo52.mapeo.escanear'), ('polo52.mapeo.gestionar')) AS p(clave)
 WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = 'polo52' AND permiso_clave = p.clave);

-- ---- RLS ----
ALTER TABLE public.polo_posiciones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polo_mapeo_bultos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polo_mapeo_items  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.polo_posiciones, public.polo_mapeo_bultos, public.polo_mapeo_items FROM anon, authenticated;
GRANT SELECT ON public.polo_posiciones, public.polo_mapeo_bultos, public.polo_mapeo_items TO authenticated;

DROP POLICY IF EXISTS polo_posiciones_ver ON public.polo_posiciones;
CREATE POLICY polo_posiciones_ver ON public.polo_posiciones FOR SELECT TO authenticated
  USING (private.tengo_permiso('polo52.mapeo.view') OR private.tengo_permiso('polo52.mapeo.escanear'));
DROP POLICY IF EXISTS polo_mapeo_bultos_ver ON public.polo_mapeo_bultos;
CREATE POLICY polo_mapeo_bultos_ver ON public.polo_mapeo_bultos FOR SELECT TO authenticated
  USING (private.tengo_permiso('polo52.mapeo.view') OR private.tengo_permiso('polo52.mapeo.escanear'));
DROP POLICY IF EXISTS polo_mapeo_items_ver ON public.polo_mapeo_items;
CREATE POLICY polo_mapeo_items_ver ON public.polo_mapeo_items FOR SELECT TO authenticated
  USING (private.tengo_permiso('polo52.mapeo.view') OR private.tengo_permiso('polo52.mapeo.escanear'));

-- ============================================================
-- Crear posiciones (una o un tramo). Devuelve cuántas se crearon.
-- ============================================================
CREATE OR REPLACE FUNCTION public.polo_posiciones_crear(p_codigos text[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.tengo_permiso('polo52.mapeo.gestionar') THEN
    RAISE EXCEPTION 'Sin permiso para crear posiciones';
  END IF;
  IF coalesce(array_length(p_codigos, 1), 0) > 1000 THEN
    RAISE EXCEPTION 'De a 1000 posiciones como máximo por vez';
  END IF;
  INSERT INTO public.polo_posiciones (codigo)
  SELECT DISTINCT upper(btrim(c)) FROM unnest(p_codigos) c WHERE btrim(c) <> ''
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Borrar una posición: solo si está vacía (los bultos no se pierden sin querer)
CREATE OR REPLACE FUNCTION public.polo_posicion_borrar(p_codigo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT private.tengo_permiso('polo52.mapeo.gestionar') THEN
    RAISE EXCEPTION 'Sin permiso para borrar posiciones';
  END IF;
  IF EXISTS (SELECT 1 FROM public.polo_mapeo_bultos WHERE posicion = upper(p_codigo)) THEN
    RAISE EXCEPTION 'La posición % tiene bultos: sacalos primero', upper(p_codigo);
  END IF;
  DELETE FROM public.polo_posiciones WHERE codigo = upper(p_codigo);
END $$;

-- ============================================================
-- Guardar un bulto escaneado en una posición.
-- p_bulto: {bulto, origen, nro, remitos[], bulto_n, bultos_total}
-- p_items: [{remito, articulo, descripcion, color, color_nombre, talle, cantidad}]
-- Si el bulto ya estaba en otra posición, se MUEVE (devuelve 'movido' y
-- de dónde venía); si ya estaba en esta, 'repetido' y no toca nada.
-- ============================================================
CREATE OR REPLACE FUNCTION public.polo_mapeo_guardar(p_posicion text, p_bulto jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pos   text := upper(btrim(p_posicion));
  v_bulto text := upper(btrim(p_bulto->>'bulto'));
  v_prev  public.polo_mapeo_bultos%ROWTYPE;
  v_id    uuid;
  v_unid  numeric;
BEGIN
  IF NOT private.tengo_permiso('polo52.mapeo.escanear') THEN
    RAISE EXCEPTION 'Sin permiso para escanear en Polo 52';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.polo_posiciones WHERE codigo = v_pos) THEN
    RAISE EXCEPTION 'La posición % no existe: creala en Posiciones', v_pos;
  END IF;
  IF v_bulto IS NULL OR v_bulto = '' THEN RAISE EXCEPTION 'Bulto vacío'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El bulto no trae artículos';
  END IF;

  SELECT * INTO v_prev FROM public.polo_mapeo_bultos WHERE bulto = v_bulto;
  IF FOUND AND v_prev.posicion = v_pos THEN
    RETURN jsonb_build_object('estado', 'repetido', 'posicion', v_pos);
  END IF;
  IF FOUND THEN
    DELETE FROM public.polo_mapeo_bultos WHERE id = v_prev.id;
  END IF;

  SELECT coalesce(sum((i->>'cantidad')::numeric), 0) INTO v_unid FROM jsonb_array_elements(p_items) i;

  INSERT INTO public.polo_mapeo_bultos (posicion, bulto, origen, nro, remitos, bulto_n, bultos_total, unidades)
  VALUES (
    v_pos, v_bulto,
    upper(coalesce(p_bulto->>'origen', '')),
    coalesce(p_bulto->>'nro', ''),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(p_bulto->'remitos')), '{}'),
    nullif(p_bulto->>'bulto_n', '')::integer,
    nullif(p_bulto->>'bultos_total', '')::integer,
    v_unid
  )
  RETURNING id INTO v_id;

  INSERT INTO public.polo_mapeo_items (bulto_id, remito, articulo, descripcion, color, color_nombre, talle, cantidad)
  SELECT v_id, i->>'remito', upper(btrim(i->>'articulo')), i->>'descripcion', i->>'color', i->>'color_nombre', i->>'talle',
         coalesce((i->>'cantidad')::numeric, 0)
    FROM jsonb_array_elements(p_items) i
   WHERE coalesce(btrim(i->>'articulo'), '') <> '';

  RETURN jsonb_build_object(
    'estado', CASE WHEN v_prev.id IS NULL THEN 'nuevo' ELSE 'movido' END,
    'posicion', v_pos,
    'antes', v_prev.posicion,
    'unidades', v_unid
  );
END $$;

-- Sacar un bulto de su posición (ya se despachó o se escaneó mal)
CREATE OR REPLACE FUNCTION public.polo_mapeo_sacar(p_bulto_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (private.tengo_permiso('polo52.mapeo.gestionar') OR private.tengo_permiso('polo52.mapeo.escanear')) THEN
    RAISE EXCEPTION 'Sin permiso para sacar bultos';
  END IF;
  DELETE FROM public.polo_mapeo_bultos WHERE id = p_bulto_id;
END $$;

REVOKE ALL ON FUNCTION public.polo_posiciones_crear(text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.polo_posicion_borrar(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.polo_mapeo_guardar(text, jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.polo_mapeo_sacar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.polo_posiciones_crear(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.polo_posicion_borrar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.polo_mapeo_guardar(text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.polo_mapeo_sacar(uuid) TO authenticated;

COMMIT;
