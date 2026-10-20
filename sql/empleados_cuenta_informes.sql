-- ============================================================================
-- Empleados que no cuentan en los informes (20/10/2026)
--
-- Aplicado en Supabase (migración empleados_cuenta_informes). Idempotente.
--
-- Marca por empleado para dejarlo afuera del informe de Eficiencia mayorista que
-- sale por WhatsApp (ver docs/mapa/Informes por WhatsApp.md): no aparece en
-- «Tiempo real en piso», no figura como responsable en la tabla por local y no
-- suma en el KPI «Personas». Sigue contando en la pantalla de Estadística VTD y
-- en todo el resto del hub: es solo para el informe.
--
-- Se marca desde la ficha del empleado (RRHH → Empleados, casilla «Cuenta en los
-- informes»). Por defecto cuentan todos.
-- ============================================================================

ALTER TABLE public.empleados
  ADD COLUMN IF NOT EXISTS cuenta_informes boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.empleados.cuenta_informes IS
  'false = no sale en el informe de Eficiencia mayorista (ni en piso, ni como responsable, ni en Personas). Solo afecta al informe.';
