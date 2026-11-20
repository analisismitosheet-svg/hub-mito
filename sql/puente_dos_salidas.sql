-- Puente SQL con dos salidas (20/11/2026, pedido del usuario: "si una no anda toma la otra").
--   logicapp_url = principal (Funnel de Tailscale)
--   respaldo_url = respaldo (quick tunnel de Cloudflare, cambia en cada arranque)
-- Las funciones de Vercel (src/lib/puenteRetry.ts) prueban la otra si una no llega.
-- publicar_urls_puente (la llama la PC, puente-sql/scripts/tunel-emergencia.ps1): una URL de
-- trycloudflare.com va al respaldo y una de ts.net a la principal, así el túnel nunca pisa al Funnel.

alter table public.sql_conexion add column if not exists respaldo_url text;

create or replace function public.publicar_urls_puente(p_token text, p_url_puente text default null, p_url_agentes text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_hash text;
begin
  select token_hash into v_hash from public.puente_secreto where id = 1;
  if v_hash is null or v_hash <> encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') then
    raise exception 'token invalido';
  end if;

  if p_url_puente is not null then
    if p_url_puente !~ '^https://[a-z0-9.-]+\.(trycloudflare\.com|ts\.net)(:[0-9]{1,5})?(/[A-Za-z0-9/_-]*)?$' then
      raise exception 'URL de puente no permitida';
    end if;
    if p_url_puente ~ '\.trycloudflare\.com' then
      update public.sql_conexion set respaldo_url = p_url_puente, updated_at = now() where id = 1;
    else
      update public.sql_conexion set logicapp_url = p_url_puente, updated_at = now() where id = 1;
    end if;
  end if;

  if p_url_agentes is not null then
    if p_url_agentes !~ '^https://[a-z0-9.-]+\.(trycloudflare\.com|ts\.net)(:[0-9]{1,5})?$' then
      raise exception 'URL de agentes no permitida';
    end if;
    update public.sql_conexion set agentes_url = p_url_agentes, updated_at = now() where id = 1;
  end if;
end;
$function$;

-- Valores de hoy: Funnel de principal, el túnel de Cloudflare actual de respaldo
update public.sql_conexion
   set respaldo_url = case when logicapp_url ~ '\.trycloudflare\.com' then logicapp_url else respaldo_url end,
       logicapp_url = 'https://desktop-oa4gu6i.tail8a2a01.ts.net/sql-bridge/health',
       updated_at = now()
 where id = 1;

select logicapp_url, respaldo_url from public.sql_conexion where id = 1;
