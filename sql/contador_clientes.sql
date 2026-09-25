-- ============================================================
-- CONTADOR DE CLIENTES (cámaras Dahua + IA en la PC del local)
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Flujo: PC del local (contador-camaras/) -> POST /api/contador-ingesta
--        (token del dispositivo) -> service role -> estas tablas.
-- El navegador SOLO lee (RLS); nunca escribe conteos.
-- ============================================================

-- ---- Dispositivos (una PC por local, puede tener varias cámaras) ----
CREATE TABLE IF NOT EXISTS public.contador_dispositivos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  local         text NOT NULL,                 -- locales.codigo
  nombre        text NOT NULL,
  token_hash    text NOT NULL UNIQUE,          -- sha256 hex del token (el token nunca se guarda)
  activo        boolean NOT NULL DEFAULT true,
  ultimo_latido timestamptz,
  estado        jsonb,                         -- { version, camaras: [{ nombre, ok, fps, error }] }
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- Conteos agregados en tramos de 15 minutos ----
-- El agente manda el TOTAL del tramo (no deltas): reenviar es idempotente.
CREATE TABLE IF NOT EXISTS public.contador_visitas (
  local          text        NOT NULL,
  camara         text        NOT NULL,
  desde          timestamptz NOT NULL,         -- inicio del tramo de 15 min
  entradas       integer     NOT NULL DEFAULT 0 CHECK (entradas >= 0),
  salidas        integer     NOT NULL DEFAULT 0 CHECK (salidas >= 0),
  transeuntes    integer     NOT NULL DEFAULT 0 CHECK (transeuntes >= 0),  -- pasan por la vereda sin entrar
  empleados      integer     NOT NULL DEFAULT 0 CHECK (empleados >= 0),    -- entradas de personal (NO suman a entradas)
  nuevos         integer     NOT NULL DEFAULT 0 CHECK (nuevos >= 0),       -- clientes vistos por 1ra vez en el día
  reingresos     integer     NOT NULL DEFAULT 0 CHECK (reingresos >= 0),   -- el mismo cliente volvió a entrar el mismo día
  dispositivo_id uuid REFERENCES public.contador_dispositivos(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (local, camara, desde)
);
-- Si la tabla ya existía de la primera versión
ALTER TABLE public.contador_visitas
  ADD COLUMN IF NOT EXISTS transeuntes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS empleados   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nuevos      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reingresos  integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS contador_visitas_desde_idx ON public.contador_visitas (desde DESC);

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('contador.view',      'locales', 'view',      'Ver contador de clientes',       860),
  ('contador.gestionar', 'locales', 'gestionar', 'Gestionar cámaras del contador', 861),
  ('ia_camaras.view',    'sistemas', 'view',     'Ver IA Cámaras',                 862),
  ('conversion.view',    'locales',  'view',     'Ver tasa de conversión',         863)
ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION private.tengo_permiso(p_clave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT private.es_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = p_clave)
$$;
REVOKE ALL ON FUNCTION private.tengo_permiso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tengo_permiso(text) TO authenticated;

-- ---- RLS ----
ALTER TABLE public.contador_dispositivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contador_visitas      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contador_visitas_ver ON public.contador_visitas;
CREATE POLICY contador_visitas_ver ON public.contador_visitas
  FOR SELECT TO authenticated USING (private.tengo_permiso('contador.view') OR private.tengo_permiso('ia_camaras.view') OR private.tengo_permiso('conversion.view'));

DROP POLICY IF EXISTS contador_disp_ver ON public.contador_dispositivos;
CREATE POLICY contador_disp_ver ON public.contador_dispositivos
  FOR SELECT TO authenticated USING (private.tengo_permiso('contador.view') OR private.tengo_permiso('ia_camaras.view') OR private.tengo_permiso('conversion.view'));

DROP POLICY IF EXISTS contador_disp_gestion ON public.contador_dispositivos;
CREATE POLICY contador_disp_gestion ON public.contador_dispositivos
  FOR ALL TO authenticated
  USING (private.tengo_permiso('contador.gestionar'))
  WITH CHECK (private.tengo_permiso('contador.gestionar'));

-- token_hash no se expone al navegador aunque tenga permiso de ver
-- (el front inserta sin .select() para no pedir la columna de vuelta)
REVOKE SELECT ON public.contador_dispositivos FROM authenticated, anon;
GRANT SELECT (id, local, nombre, activo, ultimo_latido, estado, created_at) ON public.contador_dispositivos TO authenticated;

-- ============================================================
-- Tablero: todo se agrega en la base (evita el límite de 1000 filas).
-- Horas/días en hora de Argentina.
-- ============================================================
CREATE OR REPLACE FUNCTION public.contador_resumen(p_desde date, p_hasta date, p_locales text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  tz constant text := 'America/Argentina/Buenos_Aires';
  r  jsonb;
BEGIN
  WITH v AS (
    SELECT local, camara, (desde AT TIME ZONE tz) AS ts, entradas, salidas,
           transeuntes, empleados, nuevos, reingresos
    FROM public.contador_visitas
    WHERE desde >= (p_desde::timestamp AT TIME ZONE tz)
      AND desde <  ((p_hasta + 1)::timestamp AT TIME ZONE tz)
      AND (p_locales IS NULL OR local = ANY (p_locales))
  ),
  hoy AS (
    SELECT local, sum(entradas) AS e, sum(salidas) AS s
    FROM public.contador_visitas
    WHERE desde >= (date_trunc('day', now() AT TIME ZONE tz) AT TIME ZONE tz)
      AND (p_locales IS NULL OR local = ANY (p_locales))
    GROUP BY local
  )
  SELECT jsonb_build_object(
    'totales', (SELECT jsonb_build_object(
                  'entradas', coalesce(sum(entradas), 0),
                  'salidas',  coalesce(sum(salidas), 0),
                  'transeuntes', coalesce(sum(transeuntes), 0),
                  'empleados',   coalesce(sum(empleados), 0),
                  'nuevos',      coalesce(sum(nuevos), 0),
                  'reingresos',  coalesce(sum(reingresos), 0),
                  'dias',     count(DISTINCT ts::date)) FROM v),
    'porHora', (SELECT coalesce(jsonb_agg(x ORDER BY x.hora), '[]') FROM (
                  SELECT extract(hour FROM ts)::int AS hora,
                         sum(entradas)::int AS entradas, sum(salidas)::int AS salidas,
                         round(sum(entradas)::numeric / greatest(count(DISTINCT ts::date), 1), 1) AS promedio
                  FROM v GROUP BY 1) x),
    'porDia',  (SELECT coalesce(jsonb_agg(x ORDER BY x.fecha), '[]') FROM (
                  SELECT to_char(ts::date, 'YYYY-MM-DD') AS fecha,
                         sum(entradas)::int AS entradas, sum(salidas)::int AS salidas
                  FROM v GROUP BY 1) x),
    'porLocal', (SELECT coalesce(jsonb_agg(x ORDER BY x.entradas DESC), '[]') FROM (
                  SELECT local, sum(entradas)::int AS entradas, sum(salidas)::int AS salidas,
                         sum(transeuntes)::int AS transeuntes, sum(empleados)::int AS empleados,
                         sum(nuevos)::int AS nuevos, sum(reingresos)::int AS reingresos
                  FROM v GROUP BY 1) x),
    -- Ocupación estimada ahora = entradas - salidas de hoy (nunca negativa)
    'ocupacion', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'local', local, 'entradas', e, 'salidas', s, 'adentro', greatest(e - s, 0))
                    ORDER BY local), '[]') FROM hoy)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.contador_resumen(date, date, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contador_resumen(date, date, text[]) TO authenticated;

-- ============================================================
-- IA Cámaras (Sistemas): vista previa de HOY por local + estado de las PCs.
-- ============================================================
CREATE OR REPLACE FUNCTION public.contador_locales_hoy()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH hoy AS (
    SELECT local, camara, (desde AT TIME ZONE 'America/Argentina/Buenos_Aires') AS ts,
           entradas, salidas, transeuntes, empleados, nuevos, reingresos, updated_at
    FROM public.contador_visitas
    WHERE desde >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                    AT TIME ZONE 'America/Argentina/Buenos_Aires')
  ),
  por_local AS (
    SELECT local,
           sum(entradas)::int AS entradas, sum(salidas)::int AS salidas,
           sum(transeuntes)::int AS transeuntes, sum(empleados)::int AS empleados,
           sum(nuevos)::int AS nuevos, sum(reingresos)::int AS reingresos,
           max(updated_at) AS actualizado
    FROM hoy GROUP BY local
  ),
  por_hora AS (
    SELECT local, jsonb_agg(jsonb_build_object('hora', hora, 'entradas', e) ORDER BY hora) AS horas
    FROM (SELECT local, extract(hour FROM ts)::int AS hora, sum(entradas)::int AS e FROM hoy GROUP BY 1, 2) h
    GROUP BY local
  ),
  pcs AS (
    SELECT local, jsonb_agg(jsonb_build_object(
             'id', id, 'local', local, 'nombre', nombre, 'activo', activo, 'ultimo_latido', ultimo_latido, 'estado', estado)
             ORDER BY nombre) AS dispositivos
    FROM public.contador_dispositivos GROUP BY local
  ),
  locales AS (SELECT local FROM por_local UNION SELECT local FROM pcs)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'local', l.local,
           'entradas', coalesce(p.entradas, 0), 'salidas', coalesce(p.salidas, 0),
           'transeuntes', coalesce(p.transeuntes, 0), 'empleados', coalesce(p.empleados, 0),
           'nuevos', coalesce(p.nuevos, 0), 'reingresos', coalesce(p.reingresos, 0),
           'adentro', greatest(coalesce(p.entradas, 0) - coalesce(p.salidas, 0), 0),
           'actualizado', p.actualizado,
           'horas', coalesce(h.horas, '[]'::jsonb),
           'dispositivos', coalesce(d.dispositivos, '[]'::jsonb)
         ) ORDER BY l.local), '[]'::jsonb)
  FROM locales l
  LEFT JOIN por_local p ON p.local = l.local
  LEFT JOIN por_hora  h ON h.local = l.local
  LEFT JOIN pcs       d ON d.local = l.local
$$;
REVOKE ALL ON FUNCTION public.contador_locales_hoy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contador_locales_hoy() TO authenticated;

-- ============================================================
-- CADA LOCAL VE SOLO LO SUYO (conteos, PC y link del video en vivo).
-- La central (Sistemas/gerencia) necesita 'contador.ver_todo'; admin ve todo.
-- Reemplaza las policies de SELECT de arriba. Usa private.tiene_permiso (respeta
-- overrides por usuario) y private.mi_local() (usuarios.local).
-- ============================================================
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('conversion.view',   'locales', 'view',     'Ver tasa de conversión',                  863),
  ('contador.ver_todo', 'locales', 'ver_todo', 'Ver conteo y video de TODOS los locales', 864)
ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION private.contador_puede_ver(p_local text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (private.tiene_permiso('contador.view') OR private.tiene_permiso('ia_camaras.view') OR private.tiene_permiso('conversion.view'))
     AND (private.tiene_permiso('contador.ver_todo')
          OR upper(p_local) = upper(coalesce(private.mi_local(), '')))
$$;
REVOKE ALL ON FUNCTION private.contador_puede_ver(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.contador_puede_ver(text) TO authenticated;

DROP POLICY IF EXISTS contador_visitas_ver ON public.contador_visitas;
CREATE POLICY contador_visitas_ver ON public.contador_visitas
  FOR SELECT TO authenticated USING (private.contador_puede_ver(local));

DROP POLICY IF EXISTS contador_disp_ver ON public.contador_dispositivos;
CREATE POLICY contador_disp_ver ON public.contador_dispositivos
  FOR SELECT TO authenticated USING (private.contador_puede_ver(local));

DROP POLICY IF EXISTS contador_disp_gestion ON public.contador_dispositivos;
CREATE POLICY contador_disp_gestion ON public.contador_dispositivos
  FOR ALL TO authenticated
  USING (private.tiene_permiso('contador.gestionar'))
  WITH CHECK (private.tiene_permiso('contador.gestionar'));

-- ============================================================
-- CALIBRACIÓN DESDE EL HUB (IA Cámaras → Calibrar)
-- La ingesta la devuelve a la PC en cada envío; la PC la aplica sin reiniciar.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.contador_config (
  dispositivo_id  uuid NOT NULL REFERENCES public.contador_dispositivos(id) ON DELETE CASCADE,
  camara          text NOT NULL,
  config          jsonb NOT NULL,
  actualizado     timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid DEFAULT auth.uid(),
  PRIMARY KEY (dispositivo_id, camara)
);
ALTER TABLE public.contador_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contador_config_gestion ON public.contador_config;
CREATE POLICY contador_config_gestion ON public.contador_config
  FOR ALL TO authenticated
  USING (private.tiene_permiso('contador.gestionar'))
  WITH CHECK (private.tiene_permiso('contador.gestionar'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contador_config TO authenticated;
REVOKE ALL ON public.contador_config FROM anon;
