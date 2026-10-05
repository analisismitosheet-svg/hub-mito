-- =====================================================
-- Diagnóstico: ¿qué quedó de Recepción INDO en Supabase?
-- Pegar TODO este bloque en el SQL Editor y correrlo.
-- Solo consultas: no cambia nada.
--
-- Ojo: no usar \echo, el SQL Editor de Supabase no lo soporta.
--
-- Cómo leer el resultado:
--   · La consulta 2 marca FALTA en algo -> esa es la sentencia del .sql que no se pudo
--     crear. sql/recepcion_indo.sql ya no va con BEGIN/COMMIT, así que al correrlo el
--     editor muestra en rojo la sentencia exacta que falla.
--   · Todo "ok" pero el navegador dice que no existe -> es la caché de PostgREST:
--     correr  NOTIFY pgrst, 'reload schema';
-- =====================================================

-- 1) Tablas
SELECT c.relname AS tabla, pg_size_pretty(pg_total_relation_size(c.oid)) AS tamano
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname IN ('recepcion_indo', 'recepcion_indo_proveedores')
ORDER BY 1;

-- 2) LAS CINCO FUNCIONES, con las que falten marcadas. Esta es la consulta clave:
--    si algo dice "NO EXISTE", esa es la sentencia del .sql que no se pudo crear.
--    Los parámetros salen en orden, para comparar con los que espera el navegador.
SELECT v.nombre AS funcion,
       coalesce(pg_get_function_identity_arguments(p.oid), '>>> NO EXISTE <<<') AS parametros,
       CASE WHEN p.oid IS NULL THEN 'FALTA' ELSE 'ok' END AS estado
FROM (VALUES ('recepcion_indo_importar'),
             ('recepcion_indo_resumen'),
             ('recepcion_indo_filas'),
             ('recepcion_indo_opciones'),
             ('recepcion_indo_proveedores')) AS v(nombre)
LEFT JOIN pg_proc p
       ON p.proname = v.nombre
      AND p.pronamespace = 'public'::regnamespace
ORDER BY p.oid IS NULL DESC, v.nombre;

-- 3) Helpers en private (sin esto, el script aborta al principio)
SELECT n.nspname || '.' || p.proname AS helper
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN ('tengo_permiso', 'fecha_o_null', 'entero_o_null', 'numero_o_null',
                    'recepcion_indo_firma', 'es_admin')
  AND n.nspname IN ('private', 'public')
ORDER BY 1;

-- 4) Columna generada y clave primaria (dias_atraso tiene que decir STORED)
SELECT column_name, data_type, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'recepcion_indo'
  AND (is_generated = 'ALWAYS' OR column_name = 'clave')
ORDER BY column_name;

-- 5) RLS y políticas
SELECT c.relname AS tabla, c.relrowsecurity AS rls_activo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname LIKE 'recepcion_indo%'
ORDER BY 1;

SELECT tablename, policyname, cmd, roles::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE 'recepcion_indo%'
ORDER BY tablename, policyname;

-- 6) Cuántas filas hay (0 = nunca se importó el Excel, normal si es la primera vez).
--    Esta consulta tira error si la consulta 1 no mostró las tablas: saltala en ese caso.
SELECT 'recepciones' AS que, count(*) AS filas FROM public.recepcion_indo
UNION ALL
SELECT 'proveedores del catálogo', count(*) FROM public.recepcion_indo_proveedores;