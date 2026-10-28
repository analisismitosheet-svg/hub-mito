-- ============================================================================
-- Paradas que no son ni local ni depósito (20/10/2026)
--
-- Aplicado en Supabase (migraciones tracking_paradas_fuera y
-- tracking_paradas_fuera_hueco). Idempotente.
--
-- Para el informe «Km recorridos del transporte»: dónde se quedó quieto el
-- master lejos de todo punto conocido (tracking_bases), con hora y duración.
--
-- Cómo se arma una parada: puntos seguidos del mismo vehículo y día que quedan
-- dentro de 80 m del primero (solo precisión ≤ 50 m, igual que los km).
--
-- OJO con el final de la parada: cuando el vehículo está quieto, Traccar deja de
-- mandar (hay huecos de hasta ~45 min), así que la parada se mide hasta el punto
-- que la rompe, no hasta el último punto quieto. Midiéndola del primero al último
-- punto quieto daba 0 minutos y no aparecía ninguna parada.
--
-- Al radio de cada base se le dan 100 m de más, para no marcar como «fuera» una
-- parada pegada a la puerta de un local. Por defecto cuentan desde 10 minutos.
--
-- cerca_de / cerca_m: el punto conocido más cercano y a cuántos metros quedó. Sirve
-- para ubicar la parada cuando OpenStreetMap no tiene el nombre de la calle
-- (migración tracking_paradas_fuera_cerca).
-- Ver docs/mapa/Tracking de transporte.md.
-- ============================================================================

DROP FUNCTION IF EXISTS public.tracking_paradas_fuera(date, date, integer);
CREATE FUNCTION public.tracking_paradas_fuera(p_desde date, p_hasta date, p_min_min integer DEFAULT 10)
RETURNS TABLE (vehiculo_id uuid, dia date, desde timestamptz, hasta timestamptz, minutos integer,
               lat double precision, lng double precision, cerca_de text, cerca_m integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  u record;
  a_veh uuid; a_dia date; a_lat double precision; a_lng double precision;
  a_desde timestamptz; a_hasta timestamptz; v_fin timestamptz;
BEGIN
  -- auth.role() = 'service_role': lo usa api/informe.ts para armar el informe
  IF NOT (auth.role() = 'service_role' OR private.tengo_permiso('tracking.view') OR private.es_admin()) THEN
    RAISE EXCEPTION 'Sin permiso para ver el tracking' USING ERRCODE = '42501';
  END IF;
  IF p_hasta < p_desde OR p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'Rango de fechas invalido (maximo 92 dias)';
  END IF;

  FOR u IN
    SELECT x.vehiculo_id AS veh, (x.at AT TIME ZONE 'America/Argentina/Cordoba')::date AS d_dia,
           x.lat, x.lng, x.at
      FROM public.tracking_ubicaciones x
     WHERE x.at >= (p_desde::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
       AND x.at <  ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
       AND coalesce(x.precision_m, 0) <= 50
     ORDER BY x.vehiculo_id, x.at
  LOOP
    IF a_veh = u.veh AND a_dia = u.d_dia AND public.metros_entre(a_lat, a_lng, u.lat, u.lng) <= 80 THEN
      a_hasta := u.at;
      CONTINUE;
    END IF;

    IF a_veh IS NOT NULL THEN
      v_fin := CASE WHEN a_veh = u.veh AND a_dia = u.d_dia THEN u.at ELSE a_hasta END;
      IF extract(epoch FROM v_fin - a_desde) >= p_min_min * 60
         AND NOT EXISTS (
           SELECT 1 FROM public.tracking_bases b
            WHERE abs(a_lat - b.lat) < 0.05 AND abs(a_lng - b.lng) < 0.05
              AND public.metros_entre(a_lat, a_lng, b.lat, b.lng) <= b.radio_m + 100)
      THEN
        vehiculo_id := a_veh; dia := a_dia; desde := a_desde; hasta := v_fin;
        minutos := round(extract(epoch FROM v_fin - a_desde) / 60)::int;
        lat := a_lat; lng := a_lng;
        SELECT c.nombre, c.m INTO cerca_de, cerca_m FROM (
          SELECT coalesce(nullif(btrim(b.nombre), ''), b.base_id) AS nombre,
                 round(public.metros_entre(a_lat, a_lng, b.lat, b.lng))::int AS m
            FROM public.tracking_bases b ORDER BY 2 LIMIT 1) c;
        RETURN NEXT;
      END IF;
    END IF;

    a_veh := u.veh; a_dia := u.d_dia; a_lat := u.lat; a_lng := u.lng; a_desde := u.at; a_hasta := u.at;
  END LOOP;

  -- La última del rango (no hay punto que la rompa)
  IF a_veh IS NOT NULL AND extract(epoch FROM a_hasta - a_desde) >= p_min_min * 60
     AND NOT EXISTS (
       SELECT 1 FROM public.tracking_bases b
        WHERE abs(a_lat - b.lat) < 0.05 AND abs(a_lng - b.lng) < 0.05
          AND public.metros_entre(a_lat, a_lng, b.lat, b.lng) <= b.radio_m + 100)
  THEN
    vehiculo_id := a_veh; dia := a_dia; desde := a_desde; hasta := a_hasta;
    minutos := round(extract(epoch FROM a_hasta - a_desde) / 60)::int;
    lat := a_lat; lng := a_lng;
    SELECT c.nombre, c.m INTO cerca_de, cerca_m FROM (
      SELECT coalesce(nullif(btrim(b.nombre), ''), b.base_id) AS nombre,
             round(public.metros_entre(a_lat, a_lng, b.lat, b.lng))::int AS m
        FROM public.tracking_bases b ORDER BY 2 LIMIT 1) c;
    RETURN NEXT;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.tracking_paradas_fuera(date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_paradas_fuera(date, date, integer) TO authenticated;
