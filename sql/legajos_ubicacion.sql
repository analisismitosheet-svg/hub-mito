-- ============================================================================
-- Ubicación de los legajos (Depósito Mayorista / Depósito Indo) y aviso de
-- reposiciones/transferencias a los legajos de esa ubicación (03/11/2026).
--
-- empleados.ubicacion            dónde trabaja el legajo (RRHH → Empleados).
-- private.ubicacion_de_usuario   ubicación del legajo activo de un usuario.
-- private.locales_de_ubicacion   códigos de local que le tocan a cada ubicación
--                                (Depósito Indo = INDOD y sus alias INDO/DEPO/DEPOSITO).
-- private.transfer_local_base    "POLO52 - DEPO" → "DEPO" (destinos con prefijo).
-- transferencias_de_mi_ubicacion()  campana del legajo: lotes con renglones
--                                pendientes que salen de / van a su ubicación.
-- transfer_avisos_ubicacion(lote)   lo usa api/push.ts?tipo=transferencia (service
--                                role): a qué usuarios avisar y cuánto tienen.
-- transfer_lotes.push_ubicacion_at  marca de "ya se avisó por push".
--
-- Depósito Mayorista todavía no tiene locales asignados: no recibe avisos.
-- MANTENIMIENTO (04/11/2026): los de la nómina activa con esta ubicación son a quienes
-- Arquitectura asigna los requerimientos (sql/requerimientos.sql); no tiene locales.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS ubicacion text;
ALTER TABLE public.empleados DROP CONSTRAINT IF EXISTS empleados_ubicacion_valida;
ALTER TABLE public.empleados ADD CONSTRAINT empleados_ubicacion_valida
  CHECK (ubicacion IS NULL OR ubicacion IN ('DEPOSITO MAYORISTA', 'DEPOSITO INDO', 'MANTENIMIENTO'));

ALTER TABLE public.transfer_lotes ADD COLUMN IF NOT EXISTS push_ubicacion_at timestamptz;

CREATE OR REPLACE FUNCTION private.ubicacion_de_usuario(p_usuario uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.ubicacion
    FROM public.usuarios u
    JOIN public.empleados e ON e.legajo = u.legajo
   WHERE u.id = p_usuario AND u.legajo IS NOT NULL
     AND e.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')
     AND e.ubicacion IS NOT NULL
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.locales_de_ubicacion(p_ubicacion text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE p_ubicacion
    -- Igual que ALIAS_LOCAL de Transferencias.tsx: DEPO / DEPOSITO / INDO = INDOD
    WHEN 'DEPOSITO INDO' THEN
      (SELECT array_agg(DISTINCT x) FROM unnest(private.origenes_de('INDOD') || ARRAY['INDO', 'INDOD', 'DEPO', 'DEPOSITO']) x)
    ELSE '{}'::text[]
  END
$$;

CREATE OR REPLACE FUNCTION private.transfer_local_base(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT upper(trim(regexp_replace(coalesce(p, ''), '^.*-\s*', '')))
$$;

-- Campana del legajo: lotes de los últimos 7 días con renglones pendientes de su ubicación
CREATE OR REPLACE FUNCTION public.transferencias_de_mi_ubicacion()
RETURNS TABLE(lote_id uuid, nombre text, motivo text, creado_at timestamptz, ubicacion text,
              articulos integer, unidades integer, salen integer, entran integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ubic text := private.ubicacion_de_usuario(auth.uid());
  v_locs text[];
BEGIN
  IF v_ubic IS NULL THEN RETURN; END IF;
  v_locs := private.locales_de_ubicacion(v_ubic);
  IF cardinality(v_locs) = 0 THEN RETURN; END IF;
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
END;
$$;

-- Para api/push.ts (service role): usuarios a avisar por un lote, con lo que les toca
CREATE OR REPLACE FUNCTION public.transfer_avisos_ubicacion(p_lote uuid)
RETURNS TABLE(usuario_id uuid, ubicacion text, articulos integer, unidades integer, salen integer, entran integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ubic AS (
    SELECT DISTINCT e.ubicacion, private.locales_de_ubicacion(e.ubicacion) AS locs
      FROM public.empleados e
     WHERE e.ubicacion IS NOT NULL AND e.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')
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
  )
  SELECT u.id, c.ubicacion, c.articulos, c.unidades, c.salen, c.entran
    FROM carga c
    JOIN public.empleados e ON e.ubicacion = c.ubicacion AND e.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')
    JOIN public.usuarios u ON u.legajo = e.legajo
$$;

REVOKE ALL ON FUNCTION private.ubicacion_de_usuario(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencias_de_mi_ubicacion() FROM anon, public;
REVOKE ALL ON FUNCTION public.transfer_avisos_ubicacion(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.transferencias_de_mi_ubicacion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_avisos_ubicacion(uuid) TO service_role;

-- Ubicación del legajo que inició sesión: el front la usa para mostrar
-- Mi repo en el área Depósito (rol deposito o legajo de Depósito Indo).
CREATE OR REPLACE FUNCTION public.mi_ubicacion()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT private.ubicacion_de_usuario(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.mi_ubicacion() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mi_ubicacion() TO authenticated;
