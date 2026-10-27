-- ============================================================================
-- Mapeo depósito en vivo: publica mapeo_deposito en Supabase Realtime para que
-- Mi repo, el armado y Mayorista actualicen la ubicación apenas se mapea
-- (src/lib/useUbicacionesMapeo.ts). Realtime respeta la RLS de SELECT
-- (mapeo_deposito_ver), así que nadie ve más de lo que ya podía leer.
--
-- Aplicado en Supabase (migración mapeo_realtime). Idempotente.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mapeo_deposito') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mapeo_deposito;
  END IF;
END $$;
