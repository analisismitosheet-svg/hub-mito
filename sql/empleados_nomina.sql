-- =====================================================
-- MIGRACION: Ampliar tabla empleados con datos de nómina
-- Ejecutar en Supabase SQL Editor
-- =====================================================

ALTER TABLE public.empleados
  ADD COLUMN IF NOT EXISTS lugar text,
  ADD COLUMN IF NOT EXISTS area_sector text,
  ADD COLUMN IF NOT EXISTS horas numeric,
  ADD COLUMN IF NOT EXISTS convenio text,
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS puesto text,
  ADD COLUMN IF NOT EXISTS comision text,
  ADD COLUMN IF NOT EXISTS reingreso text,
  ADD COLUMN IF NOT EXISTS fecha_ingreso date,
  ADD COLUMN IF NOT EXISTS antiguedad_2025 integer,
  ADD COLUMN IF NOT EXISTS dias_vacaciones_2025 integer,
  ADD COLUMN IF NOT EXISTS cuil text,
  ADD COLUMN IF NOT EXISTS dni text,
  ADD COLUMN IF NOT EXISTS fecha_nacimiento date,
  ADD COLUMN IF NOT EXISTS sexo text,
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS domicilio text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS codigo_os text,
  ADD COLUMN IF NOT EXISTS prepaga text,
  ADD COLUMN IF NOT EXISTS tipo_contrato text,
  ADD COLUMN IF NOT EXISTS contacto_emergencia text,
  ADD COLUMN IF NOT EXISTS parentesco text,
  ADD COLUMN IF NOT EXISTS telefono_emergencia text;

-- Índice único por legajo para poder hacer upsert al importar la nómina
CREATE UNIQUE INDEX IF NOT EXISTS empleados_legajo_uq ON public.empleados (legajo)
  WHERE legajo IS NOT NULL;