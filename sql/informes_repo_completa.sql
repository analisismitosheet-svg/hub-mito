-- Informes que se mandan solos cuando la repo del día llega al 100% (aplicado 2026-10-14)
alter table public.informes drop constraint informes_modo_check;
alter table public.informes add constraint informes_modo_check check (modo = any (array['manual','diario','repo_completa']));

-- Las RPCs de la estadística también las puede leer el servidor (service role) para armar el informe
do $$
declare d text;
begin
  d := pg_get_functiondef('public.estadistica_vtd(date,date)'::regprocedure);
  d := replace(d, 'IF NOT (private.es_admin()', 'IF NOT (auth.role() = ''service_role'' OR private.es_admin()');
  execute d;
  d := pg_get_functiondef('public.avance_vtd_rep(date,date)'::regprocedure);
  d := replace(d, 'IF NOT (private.es_admin()', 'IF NOT (auth.role() = ''service_role'' OR private.es_admin()');
  execute d;
end $$;

-- Cada 5 minutos, lunes a sábado de 8 a 21 (Argentina = UTC-3): el hub revisa si la repo terminó
-- y manda (una vez por día) los informes con modo 'repo_completa'. Ver api/informe.ts (?evento=repo).
select cron.schedule(
  'informes-repo-completa',
  '*/5 11-23,0 * * 1-6',
  $$select net.http_get('https://hub-mito.vercel.app/api/informe?evento=repo', timeout_milliseconds := 60000)$$
);
