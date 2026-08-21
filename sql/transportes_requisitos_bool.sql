-- ============================================================
-- Migracion: Requisitos de transporte -> boolean checkboxes
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Agregar columnas boolean
ALTER TABLE public.transportes
  ADD COLUMN IF NOT EXISTS requiere_remitente boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_telefono boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_direccion_retiro boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_destinatario boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_direccion_envio boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_localidad boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_cantidad_bultos boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_pago boolean DEFAULT false;

-- Migrar datos existentes (si el texto tiene contenido -> true)
UPDATE public.transportes SET
  requiere_remitente = CASE WHEN requisitos_remitente IS NOT NULL AND requisitos_remitente != '' THEN true ELSE false END,
  requiere_telefono = CASE WHEN requisitos_telefono IS NOT NULL AND requisitos_telefono != '' THEN true ELSE false END,
  requiere_direccion_retiro = CASE WHEN requisitos_direccion_retiro IS NOT NULL AND requisitos_direccion_retiro != '' THEN true ELSE false END,
  requiere_destinatario = CASE WHEN requisitos_destinatario IS NOT NULL AND requisitos_destinatario != '' THEN true ELSE false END,
  requiere_direccion_envio = CASE WHEN requisitos_direccion_envio IS NOT NULL AND requisitos_direccion_envio != '' THEN true ELSE false END,
  requiere_localidad = CASE WHEN requisitos_localidad IS NOT NULL AND requisitos_localidad != '' THEN true ELSE false END,
  requiere_cantidad_bultos = CASE WHEN requisitos_cantidad_bultos IS NOT NULL THEN true ELSE false END,
  requiere_pago = CASE WHEN requisitos_pago IS NOT NULL AND requisitos_pago != '' THEN true ELSE false END;

-- Eliminar columnas de texto
ALTER TABLE public.transportes
  DROP COLUMN IF EXISTS requisitos_remitente,
  DROP COLUMN IF EXISTS requisitos_telefono,
  DROP COLUMN IF EXISTS requisitos_direccion_retiro,
  DROP COLUMN IF EXISTS requisitos_destinatario,
  DROP COLUMN IF EXISTS requisitos_direccion_envio,
  DROP COLUMN IF EXISTS requisitos_localidad,
  DROP COLUMN IF EXISTS requisitos_cantidad_bultos,
  DROP COLUMN IF EXISTS requisitos_pago;
