-- ============================================================================
-- Repo / cascada automáticas: si se prenden (o se cambia el día / la hora) cuando
-- la hora de hoy ya pasó, NO corren en el acto: arrancan el próximo día que toque.
-- (13/11/2026: al prender la cascada a las 19:36 con hora 10:00 se cargó sola en
-- Transferencias.) Para correrla en el momento está «Correr ahora».
-- Reemplaza repo_auto_guardar de sql/repo_cascada_auto.sql.
-- ============================================================================
create or replace function public.repo_auto_guardar(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  ahora timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  hoy   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  c     public.repo_auto_config%rowtype;
begin
  if not private.tiene_permiso('transferencias.import') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  if p ? 'cascada_params' and jsonb_typeof(p->'cascada_params') <> 'object' then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  update public.repo_auto_config c set
    cascada_params        = case when p ? 'cascada_params' then p->'cascada_params' else c.cascada_params end,
    repo_activo           = coalesce((p->>'repo_activo')::boolean, c.repo_activo),
    repo_dias             = case when p ? 'repo_dias' then array(select distinct x::int from jsonb_array_elements_text(p->'repo_dias') x order by 1) else c.repo_dias end,
    repo_hora             = coalesce(p->>'repo_hora', c.repo_hora),
    repo_armado           = coalesce((p->>'repo_armado')::boolean, c.repo_armado),
    repo_armado_prioridad = coalesce(p->>'repo_armado_prioridad', c.repo_armado_prioridad),
    cascada_activo        = coalesce((p->>'cascada_activo')::boolean, c.cascada_activo),
    cascada_dias          = case when p ? 'cascada_dias' then array(select distinct x::int from jsonb_array_elements_text(p->'cascada_dias') x order by 1) else c.cascada_dias end,
    cascada_hora          = coalesce(p->>'cascada_hora', c.cascada_hora),
    actualizado_por       = auth.uid(),
    actualizado_at        = now()
  where c.id = 1
  returning * into c;

  -- Pasada la hora de hoy: se da hoy por hecho (arranca el próximo día que toque)
  if (p ? 'repo_activo' or p ? 'repo_dias' or p ? 'repo_hora') and c.repo_activo
     and extract(isodow from ahora)::int = any (c.repo_dias) and to_char(ahora, 'HH24:MI') >= c.repo_hora
     and coalesce(c.repo_corrido_el, date '1900-01-01') < hoy then
    update public.repo_auto_config set repo_corrido_el = hoy, repo_fallos = 0, repo_fallo_at = null where id = 1;
  end if;
  if (p ? 'cascada_activo' or p ? 'cascada_dias' or p ? 'cascada_hora') and c.cascada_activo
     and extract(isodow from ahora)::int = any (c.cascada_dias) and to_char(ahora, 'HH24:MI') >= c.cascada_hora
     and coalesce(c.cascada_corrido_el, date '1900-01-01') < hoy then
    update public.repo_auto_config set cascada_corrido_el = hoy, cascada_fallos = 0, cascada_fallo_at = null where id = 1;
  end if;
end $$;

revoke all on function public.repo_auto_guardar(jsonb) from public, anon;
grant execute on function public.repo_auto_guardar(jsonb) to authenticated;
