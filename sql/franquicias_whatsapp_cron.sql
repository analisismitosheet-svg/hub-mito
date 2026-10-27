-- Franquicias · Reposición diaria automática: cada 5 min pg_cron llama a
-- /api/informe?evento=franquicias, que manda por WhatsApp los envíos en cola
-- (franquicias_propuesta_envios). El puente además lo llama apenas arma una.
-- Ver src/lib/franquiciasWhatsapp.ts. Aplicado en Supabase (27/10/2026).
SELECT cron.unschedule('franquicias-whatsapp') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'franquicias-whatsapp');
SELECT cron.schedule(
  'franquicias-whatsapp',
  '*/5 * * * *',
  $$select net.http_get('https://hub-mito.vercel.app/api/informe?evento=franquicias', timeout_milliseconds := 60000)$$
);
