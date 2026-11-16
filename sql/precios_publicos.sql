-- =====================================================
-- CONSULTA DE PRECIOS PÚBLICA  (link para clientes: /precios)
--
-- Versión web del tótem ConsultaPrecios.exe: el cliente busca por código, nombre
-- o escaneando la etiqueta y ve el precio de contado (LISTA1).
--
-- El precio sale de public.articulos.precio_publico (= LISTA1 de DRAGONFISH_INDOD,
-- vía DWH.vw_DIM_ARTICULO; lo copia sync-articulos.js todos los días 07:15).
-- Sin usuario (anon): solo devuelve código, descripción y precio. Nada de stock,
-- costos ni otras listas.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.precios_publicos_buscar(p_q text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q      text := upper(btrim(coalesce(p_q, '')));
  v_cod    text;
  v_art    text;
  v_res    jsonb;
  v_act    timestamptz;
  v_pals   text[];
BEGIN
  v_q := left(v_q, 80);
  SELECT ultima_at INTO v_act FROM public.articulos_sync WHERE id = 1;
  IF length(v_q) < 2 THEN
    RETURN jsonb_build_object('resultados', '[]'::jsonb, 'actualizado', v_act);
  END IF;

  -- Código de la etiqueta: ART!COLOR!TALLE, ART%CCTALLE o N+código (como la pistola)
  v_cod := regexp_replace(v_q, '\s', '', 'g');
  v_cod := regexp_replace(v_cod, '^\d+\+', '');
  v_cod := split_part(split_part(v_cod, '!', 1), '%', 1);

  -- 1) código de artículo exacto
  SELECT a.id_art INTO v_art FROM public.articulos a
   WHERE a.id_art = v_cod AND a.precio_publico > 0;
  -- 2) código de barras (equivalencias)
  IF v_art IS NULL THEN
    SELECT e.id_art INTO v_art FROM public.equivalencias e
      JOIN public.articulos a ON a.id_art = e.id_art AND a.precio_publico > 0
     WHERE e.cod_barras = regexp_replace(v_q, '\s', '', 'g')
     LIMIT 1;
  END IF;
  IF v_art IS NOT NULL THEN
    SELECT jsonb_build_object('articulo', a.id_art, 'descripcion', a.descripcion, 'precio', a.precio_publico)
      INTO v_res FROM public.articulos a WHERE a.id_art = v_art;
    RETURN jsonb_build_object('exacto', v_res, 'resultados', jsonb_build_array(v_res), 'actualizado', v_act);
  END IF;

  -- 3) texto: todas las palabras tienen que estar (en la descripción o el código)
  IF length(v_q) < 3 THEN
    RETURN jsonb_build_object('resultados', '[]'::jsonb, 'actualizado', v_act);
  END IF;
  SELECT array_agg(replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_'))
    INTO v_pals
    FROM unnest(regexp_split_to_array(v_q, '\s+')) p
   WHERE p <> '';

  SELECT coalesce(jsonb_agg(x ORDER BY x.anio DESC NULLS LAST, x.articulo DESC), '[]'::jsonb) INTO v_res
    FROM (
      SELECT a.id_art AS articulo, a.descripcion, a.precio_publico AS precio, a.anio
        FROM public.articulos a
       WHERE a.precio_publico > 0
         AND NOT EXISTS (
           SELECT 1 FROM unnest(v_pals) p
            WHERE upper(a.descripcion) NOT LIKE '%' || p || '%'
              AND a.id_art NOT LIKE p || '%')
       ORDER BY a.anio DESC NULLS LAST, a.id_art DESC
       LIMIT 40
    ) x;
  RETURN jsonb_build_object('resultados', (SELECT coalesce(jsonb_agg(r - 'anio'), '[]'::jsonb) FROM jsonb_array_elements(v_res) r), 'actualizado', v_act);
END;
$$;

REVOKE ALL ON FUNCTION public.precios_publicos_buscar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.precios_publicos_buscar(text) TO anon, authenticated;

COMMIT;
