-- Tracking de transporte (área Administradores)
-- Ubicaciones que manda Traccar Client desde el celular de cada chofer (api/tracking.ts),
-- ubicación de los locales (bases de la app Transporte) y por cuáles tiene que pasar cada vehículo.
-- Las cargas/entregas no se copian: se leen en vivo de la base de Transporte.

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('area_administradores.view', 'area_administradores', 'view', 'Ver área Administradores', 260),
  ('tracking.view',      'administradores', 'view',      'Ver tracking de transporte',            870),
  ('tracking.gestionar', 'administradores', 'gestionar', 'Gestionar vehículos y puntos de control', 871)
ON CONFLICT (clave) DO NOTHING;

-- ---- Vehículos ----
-- dispositivo = "Identificador del dispositivo" que se carga en Traccar Client (corto y fácil de tipear,
-- ej. master-9588: es lo único que autoriza a mandar ubicaciones, no se muestra fuera del hub).
CREATE TABLE IF NOT EXISTS public.tracking_vehiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  dispositivo text NOT NULL UNIQUE CONSTRAINT tracking_vehiculos_dispositivo_check CHECK (dispositivo ~ '^[a-z0-9-]{8,60}$'),
  usuario_transporte_id uuid UNIQUE,          -- usuario TRANSPORTISTA de la app Transporte
  usuario_transporte_nombre text,
  color text NOT NULL DEFAULT '#38bdf8',
  activo boolean NOT NULL DEFAULT true,
  creado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tracking_ubicaciones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id uuid NOT NULL REFERENCES public.tracking_vehiculos(id) ON DELETE CASCADE,
  at timestamptz NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  precision_m real,
  velocidad_kmh real,
  rumbo real,
  bateria real,
  recibido_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracking_ubicaciones_veh_at ON public.tracking_ubicaciones (vehiculo_id, at DESC);
CREATE INDEX IF NOT EXISTS tracking_ubicaciones_at ON public.tracking_ubicaciones (at);

-- ---- Locales (bases de Transporte) en el mapa: son los puntos de control ----
CREATE TABLE IF NOT EXISTS public.tracking_bases (
  base_id text PRIMARY KEY,
  nombre text,
  direccion text,           -- la que se buscó para ubicarlo (OpenStreetMap)
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  radio_m integer NOT NULL DEFAULT 150 CHECK (radio_m BETWEEN 20 AND 5000)  -- dentro del radio = pasó
);

-- ---- Recorrido obligatorio: locales por donde tiene que pasar cada vehículo (chofer) ----
CREATE TABLE IF NOT EXISTS public.tracking_recorridos (
  vehiculo_id uuid NOT NULL REFERENCES public.tracking_vehiculos(id) ON DELETE CASCADE,
  base_id text NOT NULL REFERENCES public.tracking_bases(base_id) ON DELETE CASCADE,
  dias smallint[],          -- 1 = lunes … 7 = domingo; null = todos los días
  hora_limite time,         -- null = sin hora (vale todo el día)
  creado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehiculo_id, base_id)
);

ALTER TABLE public.tracking_vehiculos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_ubicaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_recorridos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_bases       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tracking_vehiculos','tracking_ubicaciones','tracking_recorridos','tracking_bases'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_ver ON public.%1$s', t);
    -- (SELECT ...): se evalúa una vez por consulta y no por fila (miles de ubicaciones por día)
    EXECUTE format('CREATE POLICY %1$s_ver ON public.%1$s FOR SELECT TO authenticated USING ((SELECT private.tengo_permiso(''tracking.view'')) OR (SELECT private.tengo_permiso(''tracking.gestionar'')))', t);
  END LOOP;
  -- Las ubicaciones solo las escribe api/tracking.ts (service role)
  FOREACH t IN ARRAY ARRAY['tracking_vehiculos','tracking_recorridos','tracking_bases'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_gestion ON public.%1$s', t);
    EXECUTE format('CREATE POLICY %1$s_gestion ON public.%1$s FOR ALL TO authenticated USING ((SELECT private.tengo_permiso(''tracking.gestionar''))) WITH CHECK ((SELECT private.tengo_permiso(''tracking.gestionar'')))', t);
  END LOOP;
END $$;

REVOKE ALL ON public.tracking_ubicaciones FROM anon;
REVOKE ALL ON public.tracking_vehiculos, public.tracking_recorridos, public.tracking_bases FROM anon;

-- ---- Distancia en metros (haversine) ----
-- En public (no private): tracking_controles_dia es SECURITY INVOKER y authenticated no usa el esquema private.
CREATE OR REPLACE FUNCTION public.metros_entre(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;
REVOKE ALL ON FUNCTION public.metros_entre(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metros_entre(double precision, double precision, double precision, double precision) TO authenticated;

-- ---- Locales que cada vehículo tenía que pasar ese día ----
-- paso_at = primera vez que el GPS entró en el radio del local.
CREATE OR REPLACE FUNCTION public.tracking_controles_dia(p_fecha date)
RETURNS TABLE (vehiculo_id uuid, base_id text, hora_limite time, paso_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT r.vehiculo_id, r.base_id, r.hora_limite,
         (SELECT min(u.at) FROM tracking_ubicaciones u
           WHERE u.vehiculo_id = r.vehiculo_id
             AND u.at >= (p_fecha::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
             AND u.at <  ((p_fecha + 1)::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
             AND abs(u.lat - b.lat) < 0.05 AND abs(u.lng - b.lng) < 0.05
             AND public.metros_entre(u.lat, u.lng, b.lat, b.lng) <= b.radio_m + coalesce(least(u.precision_m, 100), 0))
  FROM tracking_recorridos r
  JOIN tracking_bases b ON b.base_id = r.base_id
  JOIN tracking_vehiculos v ON v.id = r.vehiculo_id AND v.activo
  WHERE r.dias IS NULL OR extract(isodow FROM p_fecha)::smallint = ANY (r.dias)
$$;
REVOKE ALL ON FUNCTION public.tracking_controles_dia(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tracking_controles_dia(date) TO authenticated;

-- ---- Avisos que suenan en el celular del chofer cuando se corta la ubicación ----
CREATE TABLE IF NOT EXISTS public.tracking_push (
  endpoint text PRIMARY KEY,
  usuario_transporte_id uuid NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  creado_at timestamptz NOT NULL DEFAULT now(),
  ultimo_envio timestamptz
);
CREATE INDEX IF NOT EXISTS tracking_push_usuario ON public.tracking_push (usuario_transporte_id);
ALTER TABLE public.tracking_push ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_push_ver ON public.tracking_push;
CREATE POLICY tracking_push_ver ON public.tracking_push FOR SELECT TO authenticated
  USING ((SELECT private.tengo_permiso('tracking.view')) OR (SELECT private.tengo_permiso('tracking.gestionar')));
REVOKE ALL ON public.tracking_push FROM anon;

ALTER TABLE public.tracking_vehiculos ADD COLUMN IF NOT EXISTS ultimo_aviso timestamptz;

-- Cada 2 minutos (lunes a sábado, 6 a 21 h de Córdoba = 9 a 0 UTC); el horario fino lo decide api/tracking.ts
SELECT cron.unschedule('tracking-avisos-ubicacion') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tracking-avisos-ubicacion');
SELECT cron.schedule(
  'tracking-avisos-ubicacion',
  '*/2 9-23,0 * * 1-6',
  $$select net.http_get('https://hub-mito.vercel.app/api/tracking?vista=alertas', timeout_milliseconds := 30000)$$
);
