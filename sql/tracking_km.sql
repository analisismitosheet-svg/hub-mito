-- Km recorridos por vehículo y día (Administradores > Tracking > Km recorridos).
-- Misma lógica que kmDelDia() en src/pages/TrackingTransporte.tsx: solo puntos precisos
-- (≤ 50 m), sin saltos imposibles (> 150 km/h) y sin el temblequeo del GPS quieto
-- (los tramos < 20 m se acumulan hasta superar esa distancia).
-- minutos_mov = tiempo andando: entre puntos seguidos (menos de 2 min de diferencia) en los que
-- Traccar marcó velocidad ≥ 5 km/h.
CREATE OR REPLACE FUNCTION public.tracking_km(p_desde date, p_hasta date)
RETURNS TABLE (vehiculo_id uuid, dia date, km numeric, minutos_mov integer, primera timestamptz, ultima timestamptz)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE
  u record;
  a_veh uuid; a_dia date; a_lat double precision; a_lng double precision; a_at timestamptz; r_at timestamptz;
  d double precision; seg double precision;
  t_m double precision := 0; t_mov double precision := 0; t_pri timestamptz; t_ult timestamptz;
BEGIN
  IF p_hasta < p_desde OR p_hasta - p_desde > 400 THEN
    RAISE EXCEPTION 'Rango de fechas inválido (máximo 400 días)';
  END IF;
  FOR u IN
    SELECT x.vehiculo_id AS veh, (x.at AT TIME ZONE 'America/Argentina/Cordoba')::date AS d_dia, x.lat, x.lng, x.at, x.velocidad_kmh AS vel
    FROM tracking_ubicaciones x
    WHERE x.at >= (p_desde::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
      AND x.at <  ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
      AND coalesce(x.precision_m, 0) <= 50
    ORDER BY x.vehiculo_id, x.at
  LOOP
    IF a_veh IS DISTINCT FROM u.veh OR a_dia IS DISTINCT FROM u.d_dia THEN
      IF a_veh IS NOT NULL THEN
        vehiculo_id := a_veh; dia := a_dia; km := round((t_m / 1000)::numeric, 2);
        minutos_mov := round(t_mov / 60)::int; primera := t_pri; ultima := t_ult;
        RETURN NEXT;
      END IF;
      a_veh := u.veh; a_dia := u.d_dia; a_lat := u.lat; a_lng := u.lng; a_at := u.at;
      t_m := 0; t_mov := 0; t_pri := u.at; t_ult := u.at; r_at := u.at;
      CONTINUE;
    END IF;
    t_ult := u.at;
    -- tiempo andando: con la velocidad que marca Traccar en cada punto
    seg := extract(epoch FROM u.at - r_at);
    IF seg > 0 AND seg < 120 AND coalesce(u.vel, 0) >= 5 THEN t_mov := t_mov + seg; END IF;
    r_at := u.at;
    d := public.metros_entre(a_lat, a_lng, u.lat, u.lng);
    IF d < 20 THEN CONTINUE; END IF;
    seg := extract(epoch FROM u.at - a_at);
    IF seg > 0 AND (d / seg) * 3.6 <= 150 THEN
      t_m := t_m + d;
    END IF;
    a_lat := u.lat; a_lng := u.lng; a_at := u.at;
  END LOOP;
  IF a_veh IS NOT NULL THEN
    vehiculo_id := a_veh; dia := a_dia; km := round((t_m / 1000)::numeric, 2);
    minutos_mov := round(t_mov / 60)::int; primera := t_pri; ultima := t_ult;
    RETURN NEXT;
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.tracking_km(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_km(date, date) TO authenticated;
