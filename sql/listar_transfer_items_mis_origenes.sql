-- ============================================================================
-- listar_transfer_items: el local lo decide la base, no la pantalla
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Antes la función (SECURITY DEFINER) filtraba por la lista de orígenes que le
-- mandaba la pantalla. Problemas:
--   - una pantalla vieja (PWA en caché) mandaba la lista sin sinónimos y el
--     local no veía lo suyo (ej. GPAZD sin GRALPAZ)
--   - si no mandaba lista, un usuario de local recibía TODAS las líneas
--
-- Ahora: admin / transferencias.import / transferencias.ver_todo ven todo (o lo
-- que pidan en p_origenes); cualquier otro ve SOLO private.mis_origenes()
-- (variantes + sinónimos, sql/locales_sinonimos.sql), mande lo que mande.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.listar_transfer_items(p_lotes uuid[], p_origenes text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
  v_todo boolean;
  v_origenes text[];
BEGIN
  IF NOT (
    private.es_admin()
    OR private.tiene_permiso('transferencias.view')
    OR private.tiene_permiso('transferencias.ver_todo')
    OR private.tiene_permiso('transferencias.import')
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_todo := private.es_admin()
         OR private.tiene_permiso('transferencias.ver_todo')
         OR private.tiene_permiso('transferencias.import');

  IF v_todo THEN
    -- puede ver todo: se respeta el filtro que pida la pantalla (si pide)
    v_origenes := CASE WHEN coalesce(cardinality(p_origenes), 0) = 0 THEN NULL
                       ELSE (SELECT array_agg(upper(x)) FROM unnest(p_origenes) x) END;
  ELSE
    -- usuario de local: siempre sus nombres (variantes + sinónimos)
    v_origenes := private.mis_origenes();
  END IF;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT t.id, t.lote_id, t.orden, t.origen, t.destino, t.articulo,
           t.descripcion, t.material, t.color, t.talle, t.tipo, t.cantidad,
           t.estado, t.hecho_at
    FROM public.transfer_items t
    WHERE t.lote_id = ANY(p_lotes)
      AND (v_origenes IS NULL OR upper(coalesce(t.origen, '')) = ANY(v_origenes))
    ORDER BY t.lote_id, t.orden
  ) t;

  RETURN v_rows;
END;
$function$;
