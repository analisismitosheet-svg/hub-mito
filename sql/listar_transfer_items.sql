-- ============================================================================
-- FIX CAUSA RAÍZ (v2): "canceling statement due to statement timeout" y
-- "despliega vacío" al cargar las líneas de Transferencias.
--
-- v1 (SETOF) arregló el timeout pero el cliente PostgREST a veces no mapea
-- bien `RETURNS SETOF public.transfer_items` + `SELECT t.*`, dejando `data`
-- vacío/mal agrupado. Esta versión devuelve un array JSON explícito.
--
-- La RPC es SECURITY DEFINER: valida los permisos UNA sola vez al inicio
-- (rápido, sin RLS por-fila) y lee con el rol definitor.
--
-- Uso (desde el front):
--   listar_transfer_items(
--     p_lotes uuid[],     -- lote_ids a traer
--     p_origenes text[]   -- filtro origen (NULL/[] = todos)
--   ) -> jsonb  (array de filas)
-- ---------------------------------------------------------------------------

-- IMPORTANTE: si ya existía con RETURNS SETOF, hay que DROP primero (no se
-- puede cambiar el tipo de retorno con CREATE OR REPLACE).
-- DROP FUNCTION IF EXISTS public.listar_transfer_items(uuid[], text[]);

CREATE OR REPLACE FUNCTION public.listar_transfer_items(
  p_lotes uuid[],
  p_origenes text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT (
    private.es_admin()
    OR private.tiene_permiso('transferencias.view')
    OR private.tiene_permiso('transferencias.ver_todo')
    OR private.tiene_permiso('transferencias.import')
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_origenes IS NULL OR coalesce(cardinality(p_origenes), 0) = 0 THEN
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT t.id, t.lote_id, t.orden, t.origen, t.destino, t.articulo,
             t.descripcion, t.material, t.color, t.talle, t.tipo, t.cantidad,
             t.estado, t.hecho_at
      FROM public.transfer_items t
      WHERE t.lote_id = ANY(p_lotes)
      ORDER BY t.lote_id, t.orden
    ) t;
  ELSE
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT t.id, t.lote_id, t.orden, t.origen, t.destino, t.articulo,
             t.descripcion, t.material, t.color, t.talle, t.tipo, t.cantidad,
             t.estado, t.hecho_at
      FROM public.transfer_items t
      WHERE t.lote_id = ANY(p_lotes)
        AND upper(coalesce(t.origen, '')) = ANY(
          SELECT upper(x) FROM unnest(p_origenes) x
        )
      ORDER BY t.lote_id, t.orden
    ) t;
  END IF;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_transfer_items(uuid[], text[]) TO authenticated;
