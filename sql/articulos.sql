-- =====================================================
-- MAESTRO DE ARTÍCULOS  (sigue a equivalencias.sql)
--
-- Copia de [DWH].[dbo].[vw_DIM_ARTICULO] (M1T0O1\ZOOLOGIC) para mostrar la
-- descripción de los artículos en el hub (Mapeo depósito, etc.).
-- La llena puente-sql/scripts/sync-articulos.js (tarea programada en la PC del
-- puente), autenticada con el PUENTE_TOKEN (private.clave_sync_ok('puente', …)).
-- Solo se copian los artículos con descripción.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.articulos (
  id_art         text PRIMARY KEY,          -- mayúsculas, sin espacios
  descripcion    text NOT NULL,
  id_prov        text,
  id_grupo       text,
  id_flia        text,
  id_temporada   text,
  id_material    text,
  id_linea       text,
  publicado      boolean,
  precio_publico numeric,
  anio           integer,
  sync_gen       bigint NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.articulos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.articulos FROM anon, authenticated;
GRANT SELECT ON public.articulos TO authenticated;
DROP POLICY IF EXISTS articulos_ver ON public.articulos;
CREATE POLICY articulos_ver ON public.articulos FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.articulos_sync (
  id        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at timestamptz,
  filas     integer,
  borradas  integer,
  origen    text
);
ALTER TABLE public.articulos_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.articulos_sync FROM anon, authenticated;
GRANT SELECT ON public.articulos_sync TO authenticated;
DROP POLICY IF EXISTS articulos_sync_ver ON public.articulos_sync;
CREATE POLICY articulos_sync_ver ON public.articulos_sync FOR SELECT TO authenticated USING (true);

-- Sube un lote: [{ "id_art", "descripcion", "id_prov", … }, ...]
CREATE OR REPLACE FUNCTION public.articulos_sync_lote(p_token text, p_gen bigint, p_filas jsonb)
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

  INSERT INTO public.articulos AS a
    (id_art, descripcion, id_prov, id_grupo, id_flia, id_temporada, id_material, id_linea,
     publicado, precio_publico, anio, sync_gen, actualizado_at)
  SELECT DISTINCT ON (art)
         art,
         trim(f->>'descripcion'),
         nullif(trim(f->>'id_prov'), ''),
         nullif(trim(f->>'id_grupo'), ''),
         nullif(trim(f->>'id_flia'), ''),
         nullif(trim(f->>'id_temporada'), ''),
         nullif(trim(f->>'id_material'), ''),
         nullif(trim(f->>'id_linea'), ''),
         (f->>'publicado')::boolean,
         (f->>'precio_publico')::numeric,
         (f->>'anio')::integer,
         p_gen, now()
  FROM jsonb_array_elements(p_filas) f,
       LATERAL (SELECT upper(regexp_replace(coalesce(f->>'id_art', ''), '\s', '', 'g')) AS art) x
  WHERE art <> '' AND coalesce(trim(f->>'descripcion'), '') <> ''
  ON CONFLICT (id_art) DO UPDATE
    SET descripcion = excluded.descripcion, id_prov = excluded.id_prov, id_grupo = excluded.id_grupo,
        id_flia = excluded.id_flia, id_temporada = excluded.id_temporada, id_material = excluded.id_material,
        id_linea = excluded.id_linea, publicado = excluded.publicado, precio_publico = excluded.precio_publico,
        anio = excluded.anio, sync_gen = excluded.sync_gen,
        actualizado_at = CASE WHEN a.descripcion IS DISTINCT FROM excluded.descripcion
                              THEN now() ELSE a.actualizado_at END;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Cierra la corrida: borra lo que ya no está en la vista (solo si la corrida quedó completa).
CREATE OR REPLACE FUNCTION public.articulos_sync_fin(p_token text, p_gen bigint, p_total integer, p_origen text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_marcadas integer; v_borradas integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  SELECT count(*) INTO v_marcadas FROM public.articulos WHERE sync_gen = p_gen;
  IF p_total <= 0 OR v_marcadas < p_total THEN
    RAISE EXCEPTION 'Corrida incompleta: % de % filas; no se borra nada', v_marcadas, p_total USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.articulos WHERE sync_gen <> p_gen;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  INSERT INTO public.articulos_sync (id, ultima_at, filas, borradas, origen)
  VALUES (1, now(), v_marcadas, v_borradas, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at, filas = excluded.filas,
                                 borradas = excluded.borradas, origen = excluded.origen;
  RETURN v_borradas;
END;
$$;

REVOKE ALL ON FUNCTION public.articulos_sync_lote(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.articulos_sync_fin(text, bigint, integer, text) FROM PUBLIC;
-- El script entra con la clave anon: la protección es el token del puente
GRANT EXECUTE ON FUNCTION public.articulos_sync_lote(text, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.articulos_sync_fin(text, bigint, integer, text) TO anon, authenticated;

-- Descripción para el Mapeo depósito: primero el maestro de artículos;
-- si no está, lo de antes (transferencias y repos mayorista).
CREATE OR REPLACE FUNCTION public.mapeo_descripciones(p_codigos text[])
RETURNS TABLE (codigo text, descripcion text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH pedidos AS (
    SELECT DISTINCT upper(trim(c)) AS codigo FROM unnest(p_codigos) AS c
    WHERE private.tengo_permiso('mayorista.mapeo.view') OR private.tengo_permiso('mayorista.mapeo.escanear')
  ),
  ma AS (
    SELECT a.id_art AS codigo, a.descripcion FROM public.articulos a JOIN pedidos p ON p.codigo = a.id_art
  ),
  tr AS (
    SELECT DISTINCT ON (upper(trim(t.articulo))) upper(trim(t.articulo)) AS codigo, trim(t.descripcion) AS descripcion
    FROM public.transfer_items t
    JOIN pedidos p ON p.codigo = upper(trim(t.articulo))
    WHERE coalesce(trim(t.descripcion), '') <> ''
    ORDER BY upper(trim(t.articulo)), t.created_at DESC
  ),
  my AS (
    SELECT DISTINCT ON (upper(trim(i.codigo))) upper(trim(i.codigo)) AS codigo,
           trim(regexp_replace(regexp_replace(i.articulo, '^\(\)\s*', ''), '\s*-\s*\([^)]*\)\s*$', '')) AS descripcion
    FROM public.mayorista_items i
    JOIN pedidos p ON p.codigo = upper(trim(i.codigo))
    WHERE coalesce(trim(i.articulo), '') <> ''
    ORDER BY upper(trim(i.codigo)), i.id DESC
  )
  SELECT p.codigo, coalesce(ma.descripcion, tr.descripcion, nullif(my.descripcion, ''))
  FROM pedidos p
  LEFT JOIN ma ON ma.codigo = p.codigo
  LEFT JOIN tr ON tr.codigo = p.codigo
  LEFT JOIN my ON my.codigo = p.codigo
  WHERE coalesce(ma.descripcion, tr.descripcion, nullif(my.descripcion, '')) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.mapeo_descripciones(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapeo_descripciones(text[]) TO authenticated;

COMMIT;
