-- ============================================================================
-- Aviso en vivo de lotes nuevos de Transferencias / Cascada (18/11/2026)
--
-- Publica transfer_lotes (pocas filas, solo altas) para que la campana de los
-- locales se entere apenas se carga un lote, aunque la pestaña esté en segundo
-- plano, sin volver al sondeo de transfer_items cada 30 s que saturó la base.
-- transfer_items NO se publica: cada lote trae miles de renglones.
--
-- Idempotente.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'transfer_lotes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_lotes;
  END IF;
END $$;
