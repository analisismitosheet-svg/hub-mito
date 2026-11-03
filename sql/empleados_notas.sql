-- ============================================================================
-- Notas por celda en RRHH → Empleados (03/11/2026)
--
-- Aplicado en Supabase (migración empleados_notas). Idempotente.
--
-- Como los comentarios de Excel: cada celda de la tabla (menos Legajo y Nombre)
-- puede llevar una nota. Se guardan en un jsonb por empleado, con la clave de la
-- columna: {"codigo_os": "ALTA: 01/11/2026 PLAN 2600", "prepaga": "..."}.
-- Se ven con el triangulito en la esquina de la celda; las cargan quienes tienen
-- rrhh.empleados.edit (misma política de UPDATE que el resto de la ficha).
-- ============================================================================

ALTER TABLE public.empleados
  ADD COLUMN IF NOT EXISTS notas jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.empleados.notas IS
  'Notas por celda de la tabla de RRHH: { clave_columna: texto }.';
