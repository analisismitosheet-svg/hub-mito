-- =====================================================
-- COMPARATIVA DE PRECIOS: lectura semanal automática (pg_cron + pg_net)
-- Aplicar recién cuando /api/precios-sync esté en producción.
--
-- Vercel Hobby no sirve (cron máx. 1 por día y la función corta a los 60 s), así que el
-- cron vive en Supabase: los lunes de 03:00 a 03:58 (hora Argentina = 06 UTC) llama cada
-- 2 minutos a /api/precios-sync con la tanda que sigue (precios_web_sync.proximo). La
-- primera llamada de la semana arranca de 0; cuando termina (proximo = null) no hace nada.
-- La clave va en el header X-Sync-Token y sale del Vault (precios_sync_token).
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION private.precios_web_cron(p_marca text DEFAULT 'vans')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.precios_web_sync;
  v_desde integer;
  v_token text;
BEGIN
  SELECT * INTO s FROM public.precios_web_sync WHERE marca = p_marca;
  IF s.proximo IS NOT NULL THEN
    v_desde := s.proximo;                                   -- sigue la lectura en curso
  ELSIF s.marca IS NULL OR s.ultima_at IS NULL OR s.ultima_at < now() - interval '6 days' THEN
    v_desde := 0;                                           -- arranca la de esta semana
  ELSE
    RETURN;                                                 -- ya se leyó esta semana
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'precios_sync_token';
  PERFORM net.http_post(
    url := format('https://hub-mito.vercel.app/api/precios-sync?marca=%s&desde=%s', p_marca, v_desde),
    headers := jsonb_build_object('X-Sync-Token', v_token, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'precios-web-vans';
SELECT cron.schedule('precios-web-vans', '*/2 6 * * 1', $$SELECT private.precios_web_cron('vans')$$);
