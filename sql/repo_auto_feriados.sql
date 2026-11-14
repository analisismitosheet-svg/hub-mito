-- Repo automática: no corre los feriados (14/11/2026).
-- Usa los mismos feriados que Objetivos de locales (objetivos_feriados, los carga RR. HH.).
-- Frena la repo un feriado de TODOS los locales (local null) o de Fábrica (INDOD = MITO /
-- Depósito INDO) o de Polo 52 (POLO52). Un local cerrado no la frena (en la cascada sí:
-- ese día no dona ni recibe, ver feriados_hoy_puente). Al día siguiente el programador suma el feriado solo, porque cubre
-- los días con venta que todavía no tienen repo en Dragon (ej. lunes feriado → el martes
-- trae viernes, sábado, domingo y lunes). «Correr ahora» corre igual.
create or replace function public.repo_auto_pendiente(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ahora timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  hoy   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  c     public.repo_auto_config%rowtype;
  toca_repo boolean;
  toca_cascada boolean;
  es_feriado boolean;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into c from public.repo_auto_config where id = 1;
  es_feriado := exists (select 1 from public.objetivos_feriados f
                        where f.fecha = hoy and (f.local is null or upper(f.local) in ('INDOD', 'POLO52')));
  toca_repo := c.repo_ahora_at is not null or (
    c.repo_activo
    and not es_feriado
    and extract(isodow from ahora)::int = any (c.repo_dias)
    and to_char(ahora, 'HH24:MI') >= c.repo_hora
    and coalesce(c.repo_corrido_el, date '1900-01-01') < hoy
    and (c.repo_fallos = 0 or c.repo_fallo_at < now() - interval '15 minutes'));
  toca_cascada := c.cascada_ahora_at is not null or (
    c.cascada_activo
    and extract(isodow from ahora)::int = any (c.cascada_dias)
    and to_char(ahora, 'HH24:MI') >= c.cascada_hora
    and coalesce(c.cascada_corrido_el, date '1900-01-01') < hoy
    and (c.cascada_fallos = 0 or c.cascada_fallo_at < now() - interval '15 minutes'));
  return jsonb_build_object(
    'hoy', hoy,
    'feriado', es_feriado,
    'params', c.cascada_params,
    'repo', jsonb_build_object('toca', toca_repo, 'forzado', c.repo_ahora_at is not null, 'ultimo', c.repo_ultimo,
                               'armado', c.repo_armado, 'prioridad', c.repo_armado_prioridad),
    'cascada', jsonb_build_object('toca', toca_cascada, 'forzado', c.cascada_ahora_at is not null, 'ultimo', c.cascada_ultimo));
end $function$;

-- Próximos feriados de todos los locales, para mostrarlos en Compras > Repo diaria > Automático
-- (objetivos_feriados solo la ven objetivos.view / rrhh.feriados.view).
drop function if exists public.repo_auto_feriados();
create or replace function public.repo_auto_feriados()
 returns table (fecha date, local text, motivo text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select f.fecha, f.local, f.motivo
    from public.objetivos_feriados f
   where (f.local is null or upper(f.local) in ('INDOD', 'POLO52'))
     and f.fecha >= (now() at time zone 'America/Argentina/Buenos_Aires')::date
   order by f.fecha
   limit 5
$$;
revoke all on function public.repo_auto_feriados() from public, anon;
grant execute on function public.repo_auto_feriados() to authenticated;

-- Locales con feriado HOY para la cascada del Puente ('*' = todos los locales).
create or replace function public.feriados_hoy_puente(p_token text)
 returns text[]
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return coalesce((select array_agg(distinct coalesce(upper(f.local), '*'))
                     from public.objetivos_feriados f
                    where f.fecha = (now() at time zone 'America/Argentina/Buenos_Aires')::date), '{}');
end $$;
revoke all on function public.feriados_hoy_puente(text) from public;
grant execute on function public.feriados_hoy_puente(text) to anon, authenticated;
