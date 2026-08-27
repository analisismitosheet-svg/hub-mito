-- ============================================================================
-- PRUEBAS DEL SISTEMA RBAC DINÁMICO
-- Ejecutar en Supabase SQL Editor DESPUÉS de aplicar, en este orden:
--   1) sql/renovar_permisos.sql
--   2) sql/rbac_dinamico_schema.sql
--   3) sql/rbac_dinamico_rpcs.sql
--
-- El script es ROLLBACK-FRIENDLY: crea un submódulo temporario, verifica la
-- auto-generación y luego lo ELIMINA para no ensuciar producción.
-- ============================================================================

-- (0) SANITY: tablas creadas?
SELECT 'modules'     AS tabla, count(*) FROM public.modules
UNION ALL SELECT 'submodules', count(*) FROM public.submodules
UNION ALL SELECT 'actions',    count(*) FROM public.actions
UNION ALL SELECT 'permissions',count(*) FROM public.permissions
UNION ALL SELECT 'role_scope_settings', count(*) FROM public.role_scope_settings;

SELECT '--- Módulos sembrados ---';
SELECT key, name FROM public.modules ORDER BY "order";

SELECT '--- Acciones sembradas ---';
SELECT key, label FROM public.actions ORDER BY id;

SELECT '--- Submódulos de Locales ---';
SELECT sm.key, sm.name, sm.has_scope FROM public.submodules sm
JOIN public.modules m ON m.id = sm.module_id WHERE m.key='locales';

-- ---------------------------------------------------------------------------
-- (1) AUTO-GENERACIÓN AL CREAR UN SUBMÓDULO NUEVO
--     Insertamos un submódulo de prueba en 'locales' y verificamos que se
--     generaron permisos con todas las acciones (y el espejo en permisos).
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.submodules (module_id, key, name, has_scope, is_active)
SELECT m.id, 'prueba_auto', 'Submódulo de prueba', false, true
FROM public.modules m WHERE m.key = 'locales';

SELECT '--- Permisos auto-generados para prueba_auto (debe ser 1 por acción) ---';
SELECT p.name FROM public.permissions p
JOIN public.submodules sm ON sm.id = p.submodule_id
WHERE sm.key = 'prueba_auto'
ORDER BY p.name;

SELECT '--- Espejo en tabla legacy permisos (debe coincidir) ---';
SELECT clave FROM public.permisos WHERE clave LIKE 'locales.prueba_auto.%' ORDER BY clave;

-- Limpiamos (borra también los permisos por ON DELETE CASCADE)
DELETE FROM public.submodules WHERE key = 'prueba_auto';
COMMIT;
SELECT '--- Después del borrado (debe estar vacío) ---';
SELECT count(*) AS restantes FROM public.permisos WHERE clave LIKE 'locales.prueba_auto.%';

-- ---------------------------------------------------------------------------
-- (2) AUTO-GENERACIÓN AL CREAR UNA ACCIÓN NUEVA
--     Insertamos una acción 'print' de prueba y verificamos que se creó el
--     permiso en cada submódulo activo. Luego la eliminamos.
-- ---------------------------------------------------------------------------
BEGIN;
INSERT INTO public.actions (key, label) VALUES ('print', 'Imprimir');

SELECT '--- Permisos print generados (1 por submódulo activo) ---';
SELECT p.name FROM public.permissions p
JOIN public.actions a ON a.id = p.action_id
WHERE a.key = 'print'
ORDER BY p.name
LIMIT 10;

DELETE FROM public.actions WHERE key = 'print';
COMMIT;

-- ---------------------------------------------------------------------------
-- (3) ÁRBOL DE PERMISOS PARA EL PANEL (permisos_tree)
-- ---------------------------------------------------------------------------
SELECT '--- permisos_tree para rol "mayorista" (json) ---';
SELECT public.permisos_tree('mayorista');

SELECT '--- get_scope(rol, submodulo) ---';
SELECT public.get_scope('polo52', 'facturacion')  AS scope_polo52_facturacion,
       public.get_scope('mayorista','facturacion') AS scope_mayorista_facturacion,
       public.get_scope('polo52',  'clientes')     AS scope_polo52_clientes;

-- ---------------------------------------------------------------------------
-- (4) ROL -> lista plana de permisos
-- ---------------------------------------------------------------------------
SELECT '--- permisos_role("mayorista") — primeros 15 ---';
SELECT permiso FROM public.permisos_role('mayorista') LIMIT 15;
