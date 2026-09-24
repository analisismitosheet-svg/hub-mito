-- =====================================================
-- EQUIVALENCIAS DE CÓDIGOS DE BARRAS  (sigue a piso_finalizar_faltantes.sql)
--
-- Copia de DRAGONFISH_INDOD.ZooLogic.equivalencias (SQL Server) para el escaneo:
--   cod_barras (lo que lee la cámara o el lector) -> id_art, id_color, id_talle
--
-- La llena puente-sql/scripts/sync-equivalencias.js (tarea programada en la PC
-- del puente). El script se autentica con el PUENTE_TOKEN: acá solo se guarda
-- su hash SHA-256 (private.sync_claves), nunca el valor.
--
-- Escaneo: si el código leído existe en la tabla, se usa su artículo/color/talle;
-- si no, se interpreta como antes (CODIGO!COLOR!TALLE o CODIGO%COLORTALLE).
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.equivalencias (
  cod_barras     text PRIMARY KEY,          -- normalizado: mayúsculas, sin espacios
  id_art         text NOT NULL,
  id_color       text,
  id_talle       text,
  sync_gen       bigint NOT NULL,           -- corrida de sincronización que la escribió
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.equivalencias ENABLE ROW LEVEL SECURITY;
-- Sin políticas: nadie la lee ni la escribe directo; solo las funciones de abajo
REVOKE ALL ON public.equivalencias FROM anon, authenticated;

-- Estado de la última sincronización (para mostrar/diagnosticar)
CREATE TABLE IF NOT EXISTS public.equivalencias_sync (
  id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at    timestamptz,
  filas        integer,
  borradas     integer,
  origen       text
);
ALTER TABLE public.equivalencias_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.equivalencias_sync FROM anon, authenticated;
DROP POLICY IF EXISTS equivalencias_sync_admin ON public.equivalencias_sync;
CREATE POLICY equivalencias_sync_admin ON public.equivalencias_sync
  FOR SELECT TO authenticated USING ((SELECT private.es_admin()));
GRANT SELECT ON public.equivalencias_sync TO authenticated;

-- Hash de las claves de sincronización (nunca el valor)
CREATE TABLE IF NOT EXISTS private.sync_claves (
  nombre text PRIMARY KEY,
  hash   text NOT NULL
);

CREATE OR REPLACE FUNCTION private.clave_sync_ok(p_nombre text, p_token text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.sync_claves c
    WHERE c.nombre = p_nombre
      AND c.hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  );
$$;

-- Sube un lote: [{ "cod_barras", "id_art", "id_color", "id_talle" }, ...]
CREATE OR REPLACE FUNCTION public.equivalencias_sync_lote(p_token text, p_gen bigint, p_filas jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) > 5000 THEN
    RAISE EXCEPTION 'Lote inválido (máximo 5000 filas)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.equivalencias AS e (cod_barras, id_art, id_color, id_talle, sync_gen, actualizado_at)
  SELECT DISTINCT ON (cb)
         cb,
         upper(trim(f->>'id_art')),
         nullif(upper(trim(f->>'id_color')), ''),
         nullif(upper(trim(f->>'id_talle')), ''),
         p_gen, now()
  FROM jsonb_array_elements(p_filas) f,
       LATERAL (SELECT upper(regexp_replace(coalesce(f->>'cod_barras', ''), '\s', '', 'g')) AS cb) x
  WHERE cb <> '' AND coalesce(trim(f->>'id_art'), '') <> ''
  ON CONFLICT (cod_barras) DO UPDATE
    SET id_art = excluded.id_art, id_color = excluded.id_color, id_talle = excluded.id_talle,
        sync_gen = excluded.sync_gen,
        actualizado_at = CASE WHEN (e.id_art, e.id_color, e.id_talle) IS DISTINCT FROM
                                   (excluded.id_art, excluded.id_color, excluded.id_talle)
                              THEN now() ELSE e.actualizado_at END;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Cierra la corrida: borra lo que ya no está en el SQL Server.
-- Solo si la corrida quedó completa (p_total filas marcadas con p_gen).
CREATE OR REPLACE FUNCTION public.equivalencias_sync_fin(p_token text, p_gen bigint, p_total integer, p_origen text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_marcadas integer; v_borradas integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  SELECT count(*) INTO v_marcadas FROM public.equivalencias WHERE sync_gen = p_gen;
  IF p_total <= 0 OR v_marcadas < p_total THEN
    RAISE EXCEPTION 'Corrida incompleta: % de % filas; no se borra nada', v_marcadas, p_total USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.equivalencias WHERE sync_gen <> p_gen;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  INSERT INTO public.equivalencias_sync (id, ultima_at, filas, borradas, origen)
  VALUES (1, now(), v_marcadas, v_borradas, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at, filas = excluded.filas,
                                 borradas = excluded.borradas, origen = excluded.origen;
  RETURN v_borradas;
END;
$$;

REVOKE ALL ON FUNCTION private.clave_sync_ok(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.equivalencias_sync_lote(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equivalencias_sync_fin(text, bigint, integer, text) FROM PUBLIC;
-- El script usa la clave anon; la protección real es la clave de sincronización
GRANT EXECUTE ON FUNCTION public.equivalencias_sync_lote(text, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equivalencias_sync_fin(text, bigint, integer, text) TO anon, authenticated;

-- Escaneo: primero la equivalencia exacta; si no hay, la lectura del formato.
-- Deja de ser IMMUTABLE porque consulta la tabla.
CREATE OR REPLACE FUNCTION private.parsear_codigo_barras(p_bruto text, OUT codigo text, OUT color text, OUT talle text)
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_raw text := upper(regexp_replace(coalesce(p_bruto, ''), '\s', '', 'g'));
  v_partes text[];
BEGIN
  SELECT e.id_art, e.id_color, e.id_talle INTO codigo, color, talle
  FROM public.equivalencias e
  WHERE e.cod_barras = v_raw;
  IF FOUND THEN
    RETURN;
  END IF;

  v_partes := regexp_split_to_array(v_raw, '[!%]');
  IF array_length(v_partes, 1) >= 3 THEN
    codigo := v_partes[1];
    color  := nullif(v_partes[2], '');
    talle  := nullif(v_partes[3], '');
  ELSIF array_length(v_partes, 1) = 2 THEN
    codigo := v_partes[1];
    color  := nullif(left(v_partes[2], 2), '');
    talle  := nullif(substr(v_partes[2], 3), '');
  ELSE
    codigo := v_raw;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.parsear_codigo_barras(text) FROM PUBLIC, anon;

COMMIT;
