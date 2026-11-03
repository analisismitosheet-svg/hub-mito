-- ============================================================================
-- Transferencias de Indo en Repos Depósito (03/11/2026).
--
-- Repos Depósito (/deposito) muestra, junto a sus repos, los lotes de
-- transferencias de los últimos 30 días con renglones que SALEN de Indo, con
-- estadísticas como la Eficiencia mayorista (horas del primer al último tilde,
-- personas, prendas/hora, una fila por persona). Se marcan con
-- transferencia_marcar_deposito (sql/transferencias_deposito.sql): es el mismo
-- dato que ve Mi repo.
--
-- private.mis_locales_deposito()   ahora también para quien tiene deposito.view.
-- deposito_transferencias()        renglones + quién marcó (nombre y legajo).
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.mis_locales_deposito()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN private.es_admin()
      OR private.tiene_permiso('deposito.view')
      OR EXISTS (SELECT 1 FROM public.usuario_roles ur WHERE ur.usuario_id = auth.uid() AND ur.rol_codigo = 'deposito')
      OR private.ubicacion_de_usuario(auth.uid()) = 'DEPOSITO INDO'
    THEN private.locales_de_ubicacion('DEPOSITO INDO')
    ELSE '{}'::text[]
  END
$$;

CREATE OR REPLACE FUNCTION public.deposito_transferencias()
RETURNS TABLE(id uuid, lote_id uuid, lote_nombre text, lote_motivo text, lote_creado timestamptz,
              destino text, articulo text, descripcion text, color text, talle text, cantidad integer,
              estado text, hecho_at timestamptz, hecho_por uuid, hecho_por_nombre text, hecho_por_legajo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.mis_locales_deposito();
BEGIN
  IF cardinality(v_locs) = 0 THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.id, l.id, l.nombre, l.motivo, l.created_at,
         i.destino, i.articulo, i.descripcion, i.color, i.talle, i.cantidad,
         coalesce(i.estado, 'pendiente'), i.hecho_at, i.hecho_por,
         coalesce(e.nombre, u.nombre, u.email), u.legajo
    FROM public.transfer_lotes l
    JOIN public.transfer_items i ON i.lote_id = l.id
    LEFT JOIN public.usuarios u ON u.id = i.hecho_por
    LEFT JOIN LATERAL (
      SELECT em.nombre FROM public.empleados em
       WHERE u.legajo IS NOT NULL AND em.legajo = u.legajo
       ORDER BY (em.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')) DESC
       LIMIT 1
    ) e ON true
   WHERE l.created_at >= now() - interval '30 days'
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
   ORDER BY l.created_at DESC, i.orden;
END;
$$;

REVOKE ALL ON FUNCTION public.deposito_transferencias() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.deposito_transferencias() TO authenticated;
