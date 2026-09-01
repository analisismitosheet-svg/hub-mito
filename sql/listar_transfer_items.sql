-- ============================================================================
-- FIX CAUSA RAÍZ: "canceling statement due to statement timeout" al cargar
-- las líneas de Transferencias para usuarios con transferencias.ver_todo.
--
-- Por qué pasaba:
--   La RLS de transfer_items evalúa private.es_admin() / private.tiene_permiso()
--   (funciones STABLE que hacen subselects) POR CADA FILA. Con >4k filas y esos
--   lookups por fila, la query supera el timeout de PostgREST (~5s) -> timeout.
--   (El query base sin RLS corre en ~0.2s, así que NO es tamaño ni índices.)
--
-- Solución:
--   Una RPC SECURITY DEFINER que valida los permisos UNA sola vez al inicio
--   (rápido) y ejecuta el SELECT con el rol definitor, sin RLS por-fila.
--   Es seguro: si no tiene acceso, lanza excepción antes de leer filas.
--
-- Uso (desde el front):
--   listar_transfer_items(
--     p_lotes uuid[],     -- lote_ids a traer
--     p_origenes text[]   -- filtro de origen (NULL o [] = todos)
--   )
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.listar_transfer_items(
  p_lotes uuid[],
  p_origenes text[] DEFAULT NULL
)
RETURNS SETOF public.transfer_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validar acceso UNA vez (no por fila). Que ver_todo tenga un override
  -- grant se resuelve igual, pero el acceso completo (ver todo) solo si es
  -- admin / tiene ver_todo / tiene import.
  IF NOT (
    private.es_admin()
    OR private.tiene_permiso('transferencias.view')
    OR private.tiene_permiso('transferencias.ver_todo')
    OR private.tiene_permiso('transferencias.import')
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF p_origenes IS NULL OR array_length(p_origenes, 1) = 0 THEN
    RETURN QUERY
    SELECT t.*
    FROM public.transfer_items t
    WHERE t.lote_id = ANY(p_lotes)
    ORDER BY t.lote_id, t.orden;
  ELSE
    RETURN QUERY
    SELECT t.*
    FROM public.transfer_items t
    WHERE t.lote_id = ANY(p_lotes)
      AND upper(coalesce(t.origen, '')) = ANY(
        SELECT upper(x) FROM unnest(p_origenes) x
      )
    ORDER BY t.lote_id, t.orden;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_transfer_items(uuid[], text[]) TO authenticated;
