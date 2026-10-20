-- ============================================================================
-- Locales por los que pasó cada vehículo en el día (20/10/2026)
--
-- Aplicado en Supabase (migración tracking_locales_dia). Idempotente.
--
-- Para el informe «Km recorridos del transporte» (Envío informes y reportes):
-- al lado de los km, cuántos locales distintos tocó cada master ese día.
--
-- «Pasó por el local» con el mismo criterio que tracking_controles_dia
-- (sql/tracking_transporte.sql): el GPS entró en el radio del local, dándole al
-- radio el margen de la precisión del punto (hasta 100 m).
--
-- El depósito y la fábrica NO son locales: se marcan con es_local = false
-- (FABRICA, POLO 52 y TX-POLO), así pasar por ahí no cuenta como visita.
-- Ver docs/mapa/Tracking de transporte.md.
-- ============================================================================

BEGIN;

ALTER TABLE public.tracking_bases
  ADD COLUMN IF NOT EXISTS es_local boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tracking_bases.es_local IS
  'false = depósito/fábrica: pasar por ahí no cuenta como local visitado en el informe de km.';

UPDATE public.tracking_bases SET es_local = false
 WHERE base_id IN ('FABRICA', 'POLO52', 'TXPOLO') AND es_local;

-- ---- Locales distintos por vehículo y día ----
CREATE OR REPLACE FUNCTION public.tracking_locales_dia(p_desde date, p_hasta date)
RETURNS TABLE (vehiculo_id uuid, dia date, locales integer, nombres text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH pasos AS (
    SELECT u.vehiculo_id,
           (u.at AT TIME ZONE 'America/Argentina/Cordoba')::date AS dia,
           b.base_id,
           coalesce(nullif(btrim(b.nombre), ''), b.base_id) AS nombre
      FROM public.tracking_ubicaciones u
      JOIN public.tracking_bases b
        ON b.es_local
       -- recorte barato antes de la cuenta fina (≈ 5 km)
       AND abs(u.lat - b.lat) < 0.05 AND abs(u.lng - b.lng) < 0.05
       AND public.metros_entre(u.lat, u.lng, b.lat, b.lng) <= b.radio_m + coalesce(least(u.precision_m, 100), 0)
     WHERE u.at >= (p_desde::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
       AND u.at <  ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
     GROUP BY 1, 2, 3, 4
  )
  SELECT p.vehiculo_id, p.dia, count(*)::integer, string_agg(p.nombre, ', ' ORDER BY p.nombre)
    FROM pasos p
   WHERE auth.role() = 'service_role' OR private.tengo_permiso('tracking.view') OR private.es_admin()
   GROUP BY 1, 2
$$;

-- auth.role() = 'service_role': lo usa api/informe.ts para armar el informe
REVOKE ALL ON FUNCTION public.tracking_locales_dia(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_locales_dia(date, date) TO authenticated;

COMMIT;
