-- ============================================================================
-- Picking · modo "Por artículo": buscar también por descripción
--
-- Aplicado en Supabase (migración picking_articulo_por_descripcion). Idempotente.
-- picking_articulo(p_articulo) encontraba solo por el principio del código; ahora
-- también trae los artículos cuya descripción (maestro public.articulos) contiene
-- el texto ("boxer", "remera lisa"…).
-- ============================================================================
DO $$
DECLARE v text; v0 text;
BEGIN
  v := pg_get_functiondef('public.picking_articulo(text)'::regprocedure);
  IF position('a.descripcion ILIKE' in v) > 0 THEN RETURN; END IF;
  v0 := v;
  v := replace(v,
    E'      AND upper(trim(i.articulo)) LIKE upper(replace(replace(trim(p_articulo), ''%'', ''''), ''_'', '''')) || ''%''',
    E'      AND (upper(trim(i.articulo)) LIKE upper(replace(replace(trim(p_articulo), ''%'', ''''), ''_'', '''')) || ''%''\n           -- o por descripción (maestro de artículos): "boxer", "remera lisa"…\n           OR upper(trim(i.articulo)) IN (\n             SELECT upper(trim(a.id_art)) FROM public.articulos a\n              WHERE a.descripcion ILIKE ''%'' || replace(replace(trim(p_articulo), ''%'', ''''), ''_'', '''') || ''%''))');
  IF v = v0 THEN
    RAISE EXCEPTION 'No se encontró la condición del código';
  END IF;
  EXECUTE v;
END $$;
