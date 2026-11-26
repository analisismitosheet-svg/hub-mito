-- ============================================================================
-- Mi repo · Transferencias Depósito Indo en dos pasos (26/11/2026):
--   1) Juntar: se recorre por caja y se tilda cada SKU (artículo+color+talle)
--      cuando se sacaron todas sus unidades (sumando todos los locales).
--   2) Separar por local: se tilda a mano lo que va a cada local (estado hecho).
--
-- transfer_items.juntado_at / juntado_por: el SKU ya se sacó de la caja.
-- transferencia_juntar_deposito(ids, juntado, deposito): tilda / destilda.
-- transferencias_deposito_items() ahora devuelve también juntado_at.
-- Ejecutar DESPUÉS de sql/transferencias_polo52.sql. Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.transfer_items
  ADD COLUMN IF NOT EXISTS juntado_at timestamptz,
  ADD COLUMN IF NOT EXISTS juntado_por uuid;

-- ---- Ítems que salen del depósito (+ juntado_at al final) ----
DROP FUNCTION IF EXISTS public.transferencias_deposito_items(text);
CREATE FUNCTION public.transferencias_deposito_items(p_deposito text DEFAULT 'INDO')
RETURNS TABLE(id uuid, lote_id uuid, lote_nombre text, lote_creado timestamptz, origen text, destino text,
              articulo text, descripcion text, color text, talle text, cantidad integer, estado text, hecho_at timestamptz,
              escaneadas integer, juntado_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.locales_deposito(p_deposito);
BEGIN
  IF cardinality(v_locs) = 0 THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.id, l.id, l.nombre, l.created_at, i.origen, i.destino, i.articulo, i.descripcion, i.color, i.talle,
         i.cantidad, coalesce(i.estado, 'pendiente'), i.hecho_at, coalesce(e.escaneadas, 0), i.juntado_at
    FROM public.transfer_lotes l
    JOIN public.transfer_items i ON i.lote_id = l.id
    LEFT JOIN public.transfer_escaneos_deposito e ON e.item_id = i.id
   WHERE l.created_at >= now() - interval '7 days'
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
     AND (coalesce(i.estado, 'pendiente') = 'pendiente' OR i.hecho_at >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Cordoba') AT TIME ZONE 'America/Argentina/Cordoba')
   ORDER BY l.created_at, i.destino, i.articulo, i.color, i.talle;
END;
$$;
REVOKE ALL ON FUNCTION public.transferencias_deposito_items(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.transferencias_deposito_items(text) TO authenticated;

-- ---- Juntar / destildar un SKU (todos sus renglones) ----
DROP FUNCTION IF EXISTS public.transferencia_juntar_deposito(uuid[], boolean, text);
CREATE FUNCTION public.transferencia_juntar_deposito(p_ids uuid[], p_juntado boolean, p_deposito text DEFAULT 'INDO')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.locales_deposito(p_deposito);
  v_n integer;
BEGIN
  IF cardinality(v_locs) = 0 THEN RAISE EXCEPTION 'No autorizado'; END IF;
  UPDATE public.transfer_items i
     SET juntado_at  = CASE WHEN p_juntado THEN coalesce(i.juntado_at, now()) END,
         juntado_por = CASE WHEN p_juntado THEN coalesce(i.juntado_por, auth.uid()) END
   WHERE i.id = ANY(p_ids)
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.transferencia_juntar_deposito(uuid[], boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.transferencia_juntar_deposito(uuid[], boolean, text) TO authenticated;

COMMIT;
