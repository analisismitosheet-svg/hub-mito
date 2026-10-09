-- ============================================================================
-- Cambios en vivo (Supabase Realtime) para armados y estado de pedidos
--
-- Publica las tablas que miran Pedidos de venta, Mi repo y la campana, así
-- dejan de refrescar por temporizador (cada 10-15 s) y recargan solo cuando
-- la base avisa que algo cambió. El front igual conserva un refresco de
-- respaldo por si Realtime no está disponible.
--
-- Aplicado en Supabase (migración pedidos_realtime). Idempotente.
--
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/pedidos_realtime.sql
-- ============================================================================

DO $$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['mayorista_armados', 'mayorista_armados_items', 'pedidos_venta_estado']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = v_tabla
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_tabla);
    END IF;
  END LOOP;
END $$;
