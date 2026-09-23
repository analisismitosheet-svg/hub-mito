-- =====================================================
-- public.soy_admin(): ¿el usuario logueado es administrador?
--
-- Puente público a private.es_admin() (el rol authenticated no ve el schema
-- private). Lo usa api/sql/catalogo.ts para que solo los administradores
-- puedan explorar las bases y tablas del SQL Server.
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.soy_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.es_admin();
$$;

REVOKE ALL ON FUNCTION public.soy_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soy_admin() TO authenticated;

COMMIT;
