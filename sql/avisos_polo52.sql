-- ============================================================================
-- Avisos de transferencias que salen de Polo 52 (25/11/2026).
--
-- Igual que Depósito Indo (sql/avisos_deposito_indo.sql), para quien tiene
-- asignado el permiso polo52.transferencias.view (por usuario o por rol; el
-- admin no cuenta, como en Indo):
--   - push al celular (api/push.ts?tipo=transferencia → transfer_avisos_ubicacion,
--     ubicación 'POLO 52', abre /polo52/transferencias)
--   - campana con sonido (transferencias_de_mi_ubicacion, filas con ubicacion 'POLO 52')
--   - pueden anotar el celular (push_suscribir)
-- Solo cuentan los renglones que SALEN de Polo 52 (private.locales_deposito('POLO52')
-- usa los mismos orígenes: POLO52 / POLO52D / POLO5).
-- Ejecutar DESPUÉS de sql/transferencias_polo52.sql y sql/avisos_deposito_indo.sql. Idempotente.
-- ============================================================================

BEGIN;

-- Orígenes de Polo 52 sin mirar permisos (para el push, que corre con service role)
CREATE OR REPLACE FUNCTION private.origenes_polo52()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT array_agg(DISTINCT x) FROM unnest(private.origenes_de('POLO52') || ARRAY['POLO52', 'POLO52D', 'POLO 52']) x
$$;
REVOKE ALL ON FUNCTION private.origenes_polo52() FROM anon, public;

-- Quién recibe: permiso asignado de verdad (usuario o rol), no el admin por ser admin
CREATE OR REPLACE FUNCTION private.recibe_avisos_polo52(p_usuario uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT up.efecto = 'grant' FROM public.usuario_permisos up
      WHERE up.usuario_id = p_usuario AND up.permiso_clave = 'polo52.transferencias.view'),
    EXISTS (SELECT 1 FROM public.usuario_roles ur
              JOIN public.rol_permisos rp ON rp.rol = ur.rol_codigo
             WHERE ur.usuario_id = p_usuario AND rp.permiso_clave = 'polo52.transferencias.view')
  )
$$;
REVOKE ALL ON FUNCTION private.recibe_avisos_polo52(uuid) FROM anon, public;

-- Campana: Indo como siempre + Polo 52 (solo lo que sale)
CREATE OR REPLACE FUNCTION public.transferencias_de_mi_ubicacion()
RETURNS TABLE(lote_id uuid, nombre text, motivo text, creado_at timestamptz, ubicacion text,
              articulos integer, unidades integer, salen integer, entran integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ubic text := coalesce(private.ubicacion_de_usuario(auth.uid()),
                          CASE WHEN private.recibe_avisos_indo(auth.uid()) THEN 'DEPOSITO INDO' END);
  v_locs text[];
BEGIN
  IF v_ubic IS NOT NULL THEN
    v_locs := private.locales_de_ubicacion(v_ubic);
    IF cardinality(v_locs) > 0 THEN
      RETURN QUERY
      SELECT l.id, l.nombre, l.motivo, l.created_at, v_ubic,
             count(*)::int,
             coalesce(sum(i.cantidad), 0)::int,
             coalesce(sum(i.cantidad) FILTER (WHERE upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)), 0)::int,
             coalesce(sum(i.cantidad) FILTER (WHERE upper(trim(coalesce(i.origen, ''))) <> ALL(v_locs)), 0)::int
        FROM public.transfer_lotes l
        JOIN public.transfer_items i ON i.lote_id = l.id
       WHERE l.created_at >= now() - interval '7 days'
         AND coalesce(i.estado, 'pendiente') = 'pendiente'
         AND (upper(trim(coalesce(i.origen, ''))) = ANY(v_locs) OR private.transfer_local_base(i.destino) = ANY(v_locs))
       GROUP BY l.id, l.nombre, l.motivo, l.created_at
       ORDER BY l.created_at;
    END IF;
  END IF;

  IF private.recibe_avisos_polo52(auth.uid()) THEN
    v_locs := private.origenes_polo52();
    RETURN QUERY
    SELECT l.id, l.nombre, l.motivo, l.created_at, 'POLO 52'::text,
           count(*)::int,
           coalesce(sum(i.cantidad), 0)::int,
           coalesce(sum(i.cantidad), 0)::int,
           0
      FROM public.transfer_lotes l
      JOIN public.transfer_items i ON i.lote_id = l.id
     WHERE l.created_at >= now() - interval '7 days'
       AND coalesce(i.estado, 'pendiente') = 'pendiente'
       AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
     GROUP BY l.id, l.nombre, l.motivo, l.created_at
     ORDER BY l.created_at;
  END IF;
END;
$$;

-- Push: ubicaciones de siempre + POLO 52
CREATE OR REPLACE FUNCTION public.transfer_avisos_ubicacion(p_lote uuid)
RETURNS TABLE(usuario_id uuid, ubicacion text, articulos integer, unidades integer, salen integer, entran integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ubic AS (
    SELECT DISTINCT x.ubicacion, private.locales_de_ubicacion(x.ubicacion) AS locs
      FROM (SELECT e.ubicacion FROM public.empleados e
             WHERE e.ubicacion IS NOT NULL AND e.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')
            UNION SELECT 'DEPOSITO INDO') x
  ),
  carga AS (
    SELECT ub.ubicacion,
           count(*)::int AS articulos,
           coalesce(sum(i.cantidad), 0)::int AS unidades,
           coalesce(sum(i.cantidad) FILTER (WHERE upper(trim(coalesce(i.origen, ''))) = ANY(ub.locs)), 0)::int AS salen,
           coalesce(sum(i.cantidad) FILTER (WHERE upper(trim(coalesce(i.origen, ''))) <> ALL(ub.locs)), 0)::int AS entran
      FROM ubic ub
      JOIN public.transfer_items i ON i.lote_id = p_lote
     WHERE cardinality(ub.locs) > 0
       AND (upper(trim(coalesce(i.origen, ''))) = ANY(ub.locs) OR private.transfer_local_base(i.destino) = ANY(ub.locs))
     GROUP BY ub.ubicacion
    UNION ALL
    SELECT 'POLO 52', count(*)::int, coalesce(sum(i.cantidad), 0)::int, coalesce(sum(i.cantidad), 0)::int, 0
      FROM public.transfer_items i
     WHERE i.lote_id = p_lote
       AND upper(trim(coalesce(i.origen, ''))) = ANY(private.origenes_polo52())
    HAVING count(*) > 0
  ),
  destinatarios AS (
    SELECT u.id, e.ubicacion
      FROM public.empleados e
      JOIN public.usuarios u ON u.legajo = e.legajo
     WHERE e.ubicacion IS NOT NULL AND e.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')
    UNION
    SELECT ur.usuario_id, 'DEPOSITO INDO'
      FROM public.usuario_roles ur
     WHERE ur.rol_codigo = 'deposito'
    UNION
    SELECT u.id, 'POLO 52'
      FROM public.usuarios u
     WHERE private.recibe_avisos_polo52(u.id)
  )
  SELECT d.id, c.ubicacion, c.articulos, c.unidades, c.salen, c.entran
    FROM carga c
    JOIN destinatarios d ON d.ubicacion = c.ubicacion
$$;
REVOKE ALL ON FUNCTION public.transfer_avisos_ubicacion(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.transfer_avisos_ubicacion(uuid) TO service_role;

-- Anotar el celular: también quien recibe avisos de Polo 52
CREATE OR REPLACE FUNCTION public.push_suscribir(p_endpoint text, p_p256dh text, p_auth text, p_agente text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sin sesión'; END IF;
  IF NOT (private.tengo_permiso('mayorista.repos_piso')
          OR private.recibe_avisos_indo(auth.uid())
          OR private.recibe_avisos_polo52(auth.uid())
          -- Requerimientos (sql/requerimientos.sql): el local recibe el día y horario del arreglo
          OR private.tengo_permiso('requerimientos.cargar')
          OR private.tengo_permiso('requerimientos.tareas')
          OR coalesce((SELECT u.email FROM public.usuarios u WHERE u.id = auth.uid()), '') ILIKE '%@empleados.hub-mito.app') THEN
    RAISE EXCEPTION 'Sin permiso para recibir avisos';
  END IF;
  IF coalesce(p_endpoint, '') !~ '^https://' THEN RAISE EXCEPTION 'Suscripción inválida'; END IF;
  INSERT INTO public.push_suscripciones (endpoint, usuario_id, p256dh, auth, agente)
  VALUES (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_agente, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET usuario_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        agente = excluded.agente, creado_at = now();
END;
$$;

COMMIT;
