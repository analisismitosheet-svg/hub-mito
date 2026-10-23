-- ============================================================================
-- Ubicaciones extras (23/10/2026)
--
-- Puntos que no son locales de la app Transporte (proveedores, correo, taller,
-- banco, depósito externo). Se cargan desde la pestaña «📌 Ubicaciones extras»
-- de Tracking de transporte (TrackingTransporte.tsx) y se guardan en la misma
-- tabla tracking_bases, con es_local = false.
--
-- Ya existe la columna es_local (la agregó sql/tracking_locales_dia.sql para el
-- informe de km). Acá se deja idempotente y documentada, por si esta migración
-- corre antes que aquella. Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.tracking_bases
  ADD COLUMN IF NOT EXISTS es_local boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tracking_bases.es_local IS
  'false = ubicación extra (proveedor, correo, taller, etc.): no es un local comercial ni cuenta como local visitado.';

-- Los permisos ya los cubre tracking_transporte.sql:
--   - SELECT para tracking.view / tracking.gestionar
--   - INSERT/UPDATE/DELETE (FOR ALL) para tracking.gestionar
-- No hace falta tocar RLS: las ubicaciones extras usan la misma tabla y el
-- mismo permiso de gestión.

COMMIT;
