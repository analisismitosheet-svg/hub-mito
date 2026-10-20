-- Informes diarios a su hora (Envío informes y reportes).
-- El cron de Vercel Hobby corre una sola vez por día (08:00), así que un informe a las 20:00
-- no salía hasta que alguien abría la pantalla. Cada 5 min pg_cron llama a
-- /api/informe?evento=diarios, que manda los diarios ya vencidos, una sola vez por día
-- (reclamo atómico de ultimo_envio). Ver api/informe.ts.
SELECT cron.unschedule('informes-diarios') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'informes-diarios');
SELECT cron.schedule(
  'informes-diarios',
  '*/5 * * * *',
  $$select net.http_get('https://hub-mito.vercel.app/api/informe?evento=diarios', timeout_milliseconds := 60000)$$
);
