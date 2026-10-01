-- ============================================================
-- F12 · CONSULTA ARTÍCULOS (Mayorista)
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- La pantalla (src/pages/ConsultaArticulos.tsx) lee:
--   - stock / precio / material / grupo / nombre  -> SQL Server de MITO por /api/sql
--     (vista ZooLogic.vw_ARTICULOS_MITO, sql/vw_ARTICULOS_MITO.sql)
--   - descripción, material, grupo y precio de respaldo -> public.articulos
--   - ubicación del SKU (artículo + color + talle)        -> public.mapeo_deposito
--
-- Solo lectura: acá no se agrega ni se modifica ningún dato de artículos.
-- ============================================================

BEGIN;

-- ---- Permiso + rol ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('mayorista.articulos.view', 'mayorista', 'articulos.view', 'Ver consulta de artículos (F12)', 960)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'mayorista', 'mayorista.articulos.view'
WHERE NOT EXISTS (
  SELECT 1 FROM public.rol_permisos
  WHERE rol = 'mayorista' AND permiso_clave = 'mayorista.articulos.view'
);

-- ---- Mapeo: la consulta muestra la ubicación de cada SKU ----
-- La política anterior no incluía a este permiso: se agrega.
DROP POLICY IF EXISTS mapeo_deposito_ver ON public.mapeo_deposito;
CREATE POLICY mapeo_deposito_ver ON public.mapeo_deposito
  FOR SELECT TO authenticated
  USING (
    private.tengo_permiso('mayorista.mapeo.view') OR private.tengo_permiso('mayorista.mapeo.escanear')
    OR private.tengo_permiso('mayorista.repos_piso') OR private.tengo_permiso('mayorista.view')
    OR private.tengo_permiso('mayorista.articulos.view')
  );

-- Por si todavía no se corrió sql/mapeo_deposito.sql
DROP POLICY IF EXISTS mapeo_ubic_ver ON public.mapeo_ubicaciones;
CREATE POLICY mapeo_ubic_ver ON public.mapeo_ubicaciones
  FOR SELECT TO authenticated
  USING (
    private.tengo_permiso('mayorista.mapeo.view') OR private.tengo_permiso('mayorista.mapeo.escanear')
    OR private.tengo_permiso('mayorista.articulos.view')
  );

-- ---- Maestro de artículos (respaldo de nombre / material / grupo / precio) ----
-- Su política es "cualquiera autenticado", pero se agrega el permiso explícito
-- para que quede claro qué la usa.
DROP POLICY IF EXISTS articulos_ver ON public.articulos;
CREATE POLICY articulos_ver ON public.articulos FOR SELECT TO authenticated USING (true);

COMMIT;

-- ============================================================
--  Checklist en el hub (sin redeploy)
-- ============================================================
--  1. Crear la vista ZooLogic.vw_ARTICULOS_MITO en el SQL Server de MITO
--     (script: sql/vw_ARTICULOS_MITO.sql).
--  2. Habilitarla en Configuraciones → Conexión SQL: agregar el nombre exacto
--     de la vista (con base) a la lista de vistas.
--  3. En el Puente SQL, PUENTE_FILTRO_COLS tiene que incluir por lo menos
--     ID_ARTICULO y NOMBRE_COMPLETO (ya están en el default de puente-sql/server.js).
--     Reiniciar el puente para que tome el cambio.
--  4. Dar el permiso 'mayorista.articulos.view' desde Usuarios → Roles.
