-- ============================================================================
-- Sinónimos de locales para Reposiciones / Transferencias
--
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Un mismo local aparece con nombres distintos en los Excel (ej. General Paz:
-- "GRALPAZ" o "GPAZD"). Hasta ahora un usuario de local veía solo su nombre y
-- las variantes con/sin "D" o sin "2" final, así que GPAZD no veía lo de GRALPAZ.
--
-- 1. Tabla public.locales_sinonimos: los nombres con el mismo `grupo` son el
--    mismo local. Para sumar otro: INSERT INTO public.locales_sinonimos
--    (grupo, nombre) VALUES ('GRUPO', 'NOMBRE').
-- 2. private.origenes_de(local) / private.mis_origenes(): la lista de nombres
--    que cuentan como "mi local" = variantes de siempre + sinónimos (y sus
--    variantes). Es la ÚNICA definición; la usan:
--      - policies transfer_items_select_local / transfer_items_update_local
--      - estadisticas_transferencias (ver estadisticas_transferencias_definer.sql)
--      - public.mis_origenes_transfer(): la pantalla la pide para filtrar/marcar
-- ============================================================================

BEGIN;

-- ---- 1. Tabla de sinónimos ----
CREATE TABLE IF NOT EXISTS public.locales_sinonimos (
  nombre text PRIMARY KEY,          -- como viene en los archivos (en mayúsculas)
  grupo  text NOT NULL              -- nombres con el mismo grupo = mismo local
);

ALTER TABLE public.locales_sinonimos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS locales_sinonimos_ver ON public.locales_sinonimos;
CREATE POLICY locales_sinonimos_ver ON public.locales_sinonimos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS locales_sinonimos_admin ON public.locales_sinonimos;
CREATE POLICY locales_sinonimos_admin ON public.locales_sinonimos
  FOR ALL TO authenticated USING (private.es_admin()) WITH CHECK (private.es_admin());

INSERT INTO public.locales_sinonimos (nombre, grupo) VALUES
  ('GRALPAZ',  'GENERAL PAZ'),
  ('GPAZD',    'GENERAL PAZ'),
  -- Walmart ya lo cubre la regla de la "D" final; queda anotado igual
  ('WALMART',  'WALMART'),
  ('WALMARTD', 'WALMART')
ON CONFLICT (nombre) DO UPDATE SET grupo = EXCLUDED.grupo;

-- ---- 2. Nombres que cuentan como "mi local" ----

-- Variantes de siempre de un nombre: tal cual, sin "2" final, con/sin "D" final
CREATE OR REPLACE FUNCTION private.variantes_local(p text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT array_remove(ARRAY[
    upper(p),
    CASE WHEN right(p, 1) = '2' THEN upper(left(p, greatest(length(p) - 1, 0))) END,
    CASE WHEN right(p, 1) = 'D' THEN upper(left(p, greatest(length(p) - 1, 0))) END,
    CASE WHEN right(p, 1) <> 'D' THEN upper(p || 'D') END
  ], NULL)
$$;

-- Variantes del local + sus sinónimos (y las variantes de cada sinónimo)
CREATE OR REPLACE FUNCTION private.origenes_de(p_local text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT unnest(private.variantes_local(coalesce(p_local, ''))) AS n
  ),
  sinonimos AS (
    SELECT s2.nombre AS n
      FROM public.locales_sinonimos s1
      JOIN public.locales_sinonimos s2 ON s2.grupo = s1.grupo
     WHERE upper(s1.nombre) IN (SELECT n FROM base)
  ),
  todos AS (
    SELECT n FROM base
    UNION
    SELECT unnest(private.variantes_local(n)) FROM sinonimos
  )
  SELECT coalesce(array_agg(DISTINCT n) FILTER (WHERE n <> ''), '{}') FROM todos
$$;

CREATE OR REPLACE FUNCTION private.mis_origenes()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT private.origenes_de(private.mi_local())
$$;

-- Para la pantalla (el schema private no es accesible desde la API)
CREATE OR REPLACE FUNCTION public.mis_origenes_transfer()
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT private.mis_origenes()
$$;

-- ---- 3. Policies de transfer_items: misma regla, ahora con sinónimos ----
DROP POLICY IF EXISTS transfer_items_select_local ON public.transfer_items;
CREATE POLICY transfer_items_select_local ON public.transfer_items
  FOR SELECT
  USING (
    private.tiene_permiso('transferencias.view')
    AND upper(coalesce(origen, '')) = ANY (private.mis_origenes())
  );

DROP POLICY IF EXISTS transfer_items_update_local ON public.transfer_items;
CREATE POLICY transfer_items_update_local ON public.transfer_items
  FOR UPDATE
  USING (
    private.tiene_permiso('transferencias.view')
    AND upper(coalesce(origen, '')) = ANY (private.mis_origenes())
  );

COMMIT;
