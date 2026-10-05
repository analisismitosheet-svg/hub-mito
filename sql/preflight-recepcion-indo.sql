-- =====================================================
-- Preflight de Recepción INDO: ¿existe todo lo que necesita sql/recepcion_indo.sql?
-- Solo consultas. Correrlo ANTES del .sql evita una sentencia que falla a mitad.
-- =====================================================

-- 1) Funciones preexistentes de las que dependen los cuerpos LANGUAGE sql.
--    Postgres valida el cuerpo AL CREAR la función, así que si falta una de estas
--    el CREATE falla y la RPC nunca llega a existir.
WITH objetos AS (
  SELECT * FROM (VALUES ('private.tengo_permiso'), ('private.es_admin'), ('public.mis_permisos'))
    AS v(nombre)
), ns AS (SELECT nspname, oid FROM pg_namespace)
SELECT o.nombre AS objeto,
       CASE WHEN p.oid IS NULL THEN 'FALTA' ELSE 'ok' END AS estado,
       coalesce(pg_get_function_identity_arguments(p.oid), '') AS parametros
FROM objetos o
JOIN ns ON ns.nspname = split_part(o.nombre, '.', 1)
LEFT JOIN pg_proc p ON p.proname = split_part(o.nombre, '.', 2) AND p.pronamespace = ns.oid
ORDER BY 2, 1;

-- 2) Columnas que el script y sus policies tocan.
--    'FALTA' en usuarios.email, por ejemplo, rompe recepcion_indo_filas al crearla.
WITH esperadas AS (
  SELECT * FROM (VALUES
    ('permisos','clave'), ('permisos','modulo'), ('permisos','accion'),
    ('permisos','label'), ('permisos','orden'),
    ('rol_permisos','rol'), ('rol_permisos','permiso_clave'),
    ('usuarios','id'), ('usuarios','nombre'), ('usuarios','email')
  ) AS v(tabla, columna)
)
SELECT e.tabla || '.' || e.columna AS columna,
       coalesce(c.data_type, 'FALTA') AS tipo_real,
       CASE WHEN c.column_name IS NULL THEN 'FALTA' ELSE 'ok' END AS estado
FROM esperadas e
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public' AND c.table_name = e.tabla AND c.column_name = e.columna
ORDER BY 3, 1;

-- 3) ON CONFLICT (clave) necesita un UNIQUE en permisos.clave: si no, el primer INSERT aborta.
SELECT conname AS constraint, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.permisos'::regclass AND contype = 'u';

-- 4) Roles destino: si rol_permisos tiene FK a una tabla de roles y alguno no existe,
--    el INSERT de permisos revienta.
SELECT r.rol,
       (SELECT count(*) FROM public.rol_permisos rp WHERE rp.rol = r.rol) AS permisos_actuales,
       CASE WHEN EXISTS (SELECT 1 FROM public.roles rr WHERE rr.codigo = r.rol)
            THEN 'ok' ELSE 'sin fila en public.roles' END AS contra_roles
FROM (VALUES ('deposito'), ('compras')) AS r(rol);

-- 5) generated columns: Postgres exige IMMUTABLE, y 'greatest(0, fecha_controlada - fecha_ingreso)'
--    lo es. Esto solo confirma que no haya una d_atraso vieja que colisione.
SELECT table_name, column_name, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'dias_atraso';
