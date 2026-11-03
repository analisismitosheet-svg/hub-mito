-- ============================================================================
-- Transferencias de Depósito Indo en Mi repo (03/11/2026).
--
-- Quien ve Mi repo en el área Depósito (rol deposito o legajo con ubicación
-- Depósito Indo, ver sql/legajos_ubicacion.sql) ve los renglones de los lotes
-- de los últimos 7 días que SALEN de Indo y los marca hecho / faltante.
--
-- private.mis_locales_deposito()        locales de Indo si corresponde, si no '{}'.
-- transferencias_deposito_items()       renglones pendientes + los marcados hoy.
-- transferencia_marcar_deposito(ids, estado)  marca solo renglones que salen de Indo.
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.mis_locales_deposito()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN private.es_admin()
      OR EXISTS (SELECT 1 FROM public.usuario_roles ur WHERE ur.usuario_id = auth.uid() AND ur.rol_codigo = 'deposito')
      OR private.ubicacion_de_usuario(auth.uid()) = 'DEPOSITO INDO'
    THEN private.locales_de_ubicacion('DEPOSITO INDO')
    ELSE '{}'::text[]
  END
$$;

CREATE OR REPLACE FUNCTION public.transferencias_deposito_items()
RETURNS TABLE(id uuid, lote_id uuid, lote_nombre text, lote_creado timestamptz, origen text, destino text,
              articulo text, descripcion text, color text, talle text, cantidad integer, estado text, hecho_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.mis_locales_deposito();
BEGIN
  IF cardinality(v_locs) = 0 THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.id, l.id, l.nombre, l.created_at, i.origen, i.destino, i.articulo, i.descripcion, i.color, i.talle,
         i.cantidad, coalesce(i.estado, 'pendiente'), i.hecho_at
    FROM public.transfer_lotes l
    JOIN public.transfer_items i ON i.lote_id = l.id
   WHERE l.created_at >= now() - interval '7 days'
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
     AND (coalesce(i.estado, 'pendiente') = 'pendiente' OR i.hecho_at >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Cordoba') AT TIME ZONE 'America/Argentina/Cordoba')
   ORDER BY l.created_at, i.destino, i.articulo, i.color, i.talle;
END;
$$;

CREATE OR REPLACE FUNCTION public.transferencia_marcar_deposito(p_ids uuid[], p_estado text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.mis_locales_deposito();
  v_n integer;
BEGIN
  IF cardinality(v_locs) = 0 THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_estado NOT IN ('pendiente', 'hecho', 'faltante') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE public.transfer_items i
     SET estado = p_estado,
         hecho = (p_estado = 'hecho'),
         hecho_at = CASE WHEN p_estado = 'pendiente' THEN NULL ELSE now() END,
         hecho_por = CASE WHEN p_estado = 'pendiente' THEN NULL ELSE auth.uid() END
   WHERE i.id = ANY(p_ids)
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION private.mis_locales_deposito() FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencias_deposito_items() FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencia_marcar_deposito(uuid[], text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.transferencias_deposito_items() TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_marcar_deposito(uuid[], text) TO authenticated;
