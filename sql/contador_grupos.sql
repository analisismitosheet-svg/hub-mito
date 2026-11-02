-- Contador: grupos de personas (02/11/2026). Aditiva: columna nueva + suma en los resúmenes.
-- Ya incluido en contador_clientes.sql; este archivo es solo para aplicarlo suelto.

-- Grupos (02/11/2026): personas que cruzan la puerta juntas cuentan como 1 grupo (además de cada entrada)
ALTER TABLE public.contador_visitas
  ADD COLUMN IF NOT EXISTS grupos      integer NOT NULL DEFAULT 0 CHECK (grupos >= 0);

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
           transeuntes, empleados, nuevos, reingresos, grupos
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
                  'grupos',      coalesce(sum(grupos), 0),
                  'dias',     count(DISTINCT ts::date)) FROM v),
    'porHora', (SELECT coalesce(jsonb_agg(x ORDER BY x.hora), '[]') FROM (
                  SELECT extract(hour FROM ts)::int AS hora,
                         sum(entradas)::int AS entradas, sum(salidas)::int AS salidas,
                         round(sum(entradas)::numeric / greatest(count(DISTINCT ts::date), 1), 1) AS promedio
                  FROM v GROUP BY 1) x),
    'porDia',  (SELECT coalesce(jsonb_agg(x ORDER BY x.fecha), '[]') FROM (
                  SELECT to_char(ts::date, 'YYYY-MM-DD') AS fecha,
                         sum(entradas)::int AS entradas, sum(salidas)::int AS salidas, sum(grupos)::int AS grupos
                  FROM v GROUP BY 1) x),
    -- Días en que cada local realmente MIDIÓ (al menos una entrada). La conversión
    -- contra las ventas solo puede contar los tickets de esos días: en los demás hay
    -- venta pero no conteo de cámara, y mezclarlos infla/desinfla el porcentaje.
    -- Solo se mandan los días con entradas > 0 (los de 0 no aportan al cociente).
    'porLocalDia', (SELECT coalesce(jsonb_agg(x ORDER BY x.local, x.fecha), '[]') FROM (
                  SELECT local, to_char(ts::date, 'YYYY-MM-DD') AS fecha, sum(entradas)::int AS entradas,
                         sum(grupos)::int AS grupos
                  FROM v GROUP BY 1, 2 HAVING sum(entradas) > 0) x),
    'porLocal', (SELECT coalesce(jsonb_agg(x ORDER BY x.entradas DESC), '[]') FROM (
                  SELECT local, sum(entradas)::int AS entradas, sum(salidas)::int AS salidas,
                         sum(transeuntes)::int AS transeuntes, sum(empleados)::int AS empleados,
                         sum(nuevos)::int AS nuevos, sum(reingresos)::int AS reingresos,
                         sum(grupos)::int AS grupos
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

CREATE OR REPLACE FUNCTION public.contador_locales_hoy()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH hoy AS (
    SELECT local, camara, (desde AT TIME ZONE 'America/Argentina/Buenos_Aires') AS ts,
           entradas, salidas, transeuntes, empleados, nuevos, reingresos, grupos, updated_at
    FROM public.contador_visitas
    WHERE desde >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
                    AT TIME ZONE 'America/Argentina/Buenos_Aires')
  ),
  por_local AS (
    SELECT local,
           sum(entradas)::int AS entradas, sum(salidas)::int AS salidas,
           sum(transeuntes)::int AS transeuntes, sum(empleados)::int AS empleados,
           sum(nuevos)::int AS nuevos, sum(reingresos)::int AS reingresos,
           sum(grupos)::int AS grupos,
           max(updated_at) AS actualizado
    FROM hoy GROUP BY local
  ),
  por_hora AS (
    SELECT local, jsonb_agg(jsonb_build_object(
             'hora', hora, 'entradas', e, 'salidas', s,
             'transeuntes', t, 'empleados', emp, 'nuevos', n, 'reingresos', r, 'grupos', g
           ) ORDER BY hora) AS horas
    FROM (
      SELECT local, extract(hour FROM ts)::int AS hora,
             sum(entradas)::int AS e, sum(salidas)::int AS s,
             sum(transeuntes)::int AS t, sum(empleados)::int AS emp,
             sum(nuevos)::int AS n, sum(reingresos)::int AS r, sum(grupos)::int AS g
      FROM hoy GROUP BY 1, 2
    ) h
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
           'grupos', coalesce(p.grupos, 0),
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
