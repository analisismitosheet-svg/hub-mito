-- ============================================================
-- MAPEO DEPÓSITO: descripción de los artículos (provisorio)
-- Ejecutar en Supabase SQL Editor. Idempotente. (Ya aplicado en hub-mito.)
--
-- No hay maestro de artículos en Supabase: la descripción se saca de
-- transferencias (más limpia) y, si no está, de repos mayorista
-- ("()AGNES SOCKS CAPTAIN FIN - (U02)" -> "AGNES SOCKS CAPTAIN FIN").
-- A reemplazar por la vista de artículos de Dragonfish cuando exista.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mapeo_descripciones(p_codigos text[])
RETURNS TABLE (codigo text, descripcion text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH pedidos AS (
    SELECT DISTINCT upper(trim(c)) AS codigo FROM unnest(p_codigos) AS c
    WHERE private.tengo_permiso('mayorista.mapeo.view') OR private.tengo_permiso('mayorista.mapeo.escanear')
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
  SELECT p.codigo, coalesce(tr.descripcion, nullif(my.descripcion, ''))
  FROM pedidos p
  LEFT JOIN tr ON tr.codigo = p.codigo
  LEFT JOIN my ON my.codigo = p.codigo
  WHERE tr.descripcion IS NOT NULL OR nullif(my.descripcion, '') IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.mapeo_descripciones(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mapeo_descripciones(text[]) TO authenticated;
