-- ============================================================
-- Migración: Agregar columnas a transportes
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE public.transportes
  ADD COLUMN IF NOT EXISTS web text,
  ADD COLUMN IF NOT EXISTS retiro_calera text,
  ADD COLUMN IF NOT EXISTS retiro_polo52 text,
  ADD COLUMN IF NOT EXISTS via_solicitud_retiro text DEFAULT 'WhatsApp',
  ADD COLUMN IF NOT EXISTS etiquetas text,
  ADD COLUMN IF NOT EXISTS requisitos_remitente text,
  ADD COLUMN IF NOT EXISTS requisitos_telefono text,
  ADD COLUMN IF NOT EXISTS requisitos_direccion_retiro text,
  ADD COLUMN IF NOT EXISTS requisitos_destinatario text,
  ADD COLUMN IF NOT EXISTS requisitos_direccion_envio text,
  ADD COLUMN IF NOT EXISTS requisitos_localidad text,
  ADD COLUMN IF NOT EXISTS requisitos_cantidad_bultos integer,
  ADD COLUMN IF NOT EXISTS requisitos_pago text;
