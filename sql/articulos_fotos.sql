-- =====================================================
-- FOTOS DE ARTÍCULOS POR TIENDA WEB  (para la consulta de precios pública /precios)
--
-- Una fila por artículo y origen:
--   'indonesiashop' -> indonesiashop.com.ar (Tiendanube, tienda 1245791): la llena
--                      puente-sql/scripts/sync-fotos-tiendanube.js con la API (solo lectura).
--   'ventasxmayor'  -> las de public/fotos-articulos.json (Captain Fin + Zimith), subidas con
--                      el mismo script (--json).
-- Solo se guardan artículos que existen en public.articulos. Nadie lee la tabla directo:
-- las fotos salen por precios_publicos_buscar (sql/precios_publicos.sql).
-- Escribe el script con el PUENTE_TOKEN (private.clave_sync_ok('puente', …)), como los otros syncs.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.articulos_fotos (
  id_art         text NOT NULL,
  origen         text NOT NULL,
  fotos          text[] NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id_art, origen)
);
ALTER TABLE public.articulos_fotos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.articulos_fotos FROM anon, authenticated;

-- Sube un lote de un origen: [{ "id_art": "CF175121", "fotos": ["https://…", …] }, …]
-- Devuelve cuántas filas quedaron (los artículos que no existen en el maestro se ignoran).
CREATE OR REPLACE FUNCTION public.articulos_fotos_sync_lote(p_token text, p_origen text, p_filas jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF p_origen NOT IN ('indonesiashop', 'ventasxmayor') THEN
    RAISE EXCEPTION 'Origen inválido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) > 2000 THEN
    RAISE EXCEPTION 'Lote inválido (máximo 2000 filas)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.articulos_fotos AS f (id_art, origen, fotos, actualizado_at)
  SELECT x.art, p_origen, x.fotos, now()
    FROM (
      SELECT DISTINCT ON (art) art,
             ARRAY(SELECT u FROM jsonb_array_elements_text(e->'fotos') u
                    WHERE u ~ '^https://[A-Za-z0-9.-]+/[^\s"''<>]+$' LIMIT 14) AS fotos
        FROM jsonb_array_elements(p_filas) e,
             LATERAL (SELECT upper(btrim(e->>'id_art')) AS art) a
    ) x
    JOIN public.articulos ar ON ar.id_art = x.art
   WHERE cardinality(x.fotos) > 0
  ON CONFLICT (id_art, origen) DO UPDATE SET fotos = EXCLUDED.fotos, actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Al terminar una corrida completa: borra las fotos de ese origen que no vinieron (productos que ya no están)
CREATE OR REPLACE FUNCTION public.articulos_fotos_sync_fin(p_token text, p_origen text, p_desde timestamptz)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  DELETE FROM public.articulos_fotos WHERE origen = p_origen AND actualizado_at < p_desde;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.articulos_fotos_sync_lote(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.articulos_fotos_sync_fin(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.articulos_fotos_sync_lote(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.articulos_fotos_sync_fin(text, text, timestamptz) TO anon, authenticated;

COMMIT;
