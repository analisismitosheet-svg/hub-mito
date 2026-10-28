-- ============================================================================
-- Locales → Objetivos (28/10/2026)
--
-- Objetivo de venta por local y por día, que se arma solo cuando se carga el IPC del mes:
--   Objetivo_2026(fecha) = Venta_2025(fecha − 364 días) × (1 + IPC del mes de la fecha)
--   (364 días = 52 semanas: el día de la semana coincide siempre)
--
-- CFR4 (Captain Fin Río 4, abrió en nov-2025) se regenera desde CFR9: por cada semana ISO
-- de 2025, el domingo de CFR9 se reparte entre lunes y sábado en proporción a la venta de
-- cada día. CFR4 = CFR9 sin domingos, con el mismo total semanal (domingo cerrado).
--
-- Venta = tickets netos (TICKET% no anulados, las notas de crédito restan), igual que la
-- tasa de conversión. La sube el puente: puente-sql/scripts/sync-ventas-locales.js.
--
-- Aplicado en Supabase (migración objetivos_locales). Idempotente.
-- ============================================================================

-- Permisos
insert into public.permisos (clave, modulo, accion, label, orden) values
  ('objetivos.view', 'locales', 'view', 'Ver objetivos de los locales', 864),
  ('objetivos.edit', 'locales', 'edit', 'Cargar el IPC de los objetivos', 865)
on conflict (clave) do nothing;

-- Venta diaria por local (la escribe solo el puente)
create table if not exists public.ventas_locales_dia (
  local text not null,
  fecha date not null,
  total numeric not null default 0,
  tickets integer not null default 0,
  actualizado_at timestamptz not null default now(),
  primary key (local, fecha)
);
alter table public.ventas_locales_dia enable row level security;
drop policy if exists ventas_locales_dia_ver on public.ventas_locales_dia;
create policy ventas_locales_dia_ver on public.ventas_locales_dia for select to authenticated
  using (private.tengo_permiso('objetivos.view') or private.tengo_permiso('conversion.view'));

-- IPC mensual (%), lo carga la pantalla
create table if not exists public.ipc_mensual (
  anio integer not null,
  mes integer not null check (mes between 1 and 12),
  pct numeric not null check (pct > -50 and pct < 100),
  cargado_por uuid default auth.uid(),
  actualizado_at timestamptz not null default now(),
  primary key (anio, mes)
);
alter table public.ipc_mensual enable row level security;
drop policy if exists ipc_mensual_ver on public.ipc_mensual;
create policy ipc_mensual_ver on public.ipc_mensual for select to authenticated
  using (private.tengo_permiso('objetivos.view'));
drop policy if exists ipc_mensual_editar on public.ipc_mensual;
create policy ipc_mensual_editar on public.ipc_mensual for all to authenticated
  using (private.tengo_permiso('objetivos.edit'))
  with check (private.tengo_permiso('objetivos.edit'));

-- ---------------------------------------------------------------------------
-- Puente: sube/actualiza la venta diaria. p_filas: [{local, fecha, total, tickets}]
-- ---------------------------------------------------------------------------
create or replace function public.ventas_locales_dia_sync(p_token text, p_filas jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  insert into public.ventas_locales_dia (local, fecha, total, tickets, actualizado_at)
  select upper(btrim(e->>'local')), (e->>'fecha')::date, coalesce((e->>'total')::numeric, 0),
         coalesce((e->>'tickets')::int, 0), now()
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) e
   where nullif(btrim(e->>'local'), '') is not null and e->>'fecha' ~ '^\d{4}-\d{2}-\d{2}$'
  on conflict (local, fecha) do update
    set total = excluded.total, tickets = excluded.tickets, actualizado_at = now()
    where ventas_locales_dia.total is distinct from excluded.total
       or ventas_locales_dia.tickets is distinct from excluded.tickets;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ventas_locales_dia_sync(text, jsonb) from public;
grant execute on function public.ventas_locales_dia_sync(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Objetivos por local y día del rango. Solo salen los días cuyo mes tiene IPC cargado.
--   venta_base = venta del día base (fecha − 364); para CFR4, la generada desde CFR9
--   opera = el local vendió ese día base (si no: celda gris)
-- ---------------------------------------------------------------------------
create or replace function public.objetivos_locales_dia(p_desde date, p_hasta date)
returns table (local text, fecha date, fecha_base date, venta_base numeric, ipc numeric, objetivo numeric, opera boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (private.tengo_permiso('objetivos.view') or auth.role() = 'service_role') then
    raise exception 'Sin permiso para ver los objetivos' using errcode = '42501';
  end if;
  if p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango inválido (máximo 400 días)';
  end if;
  return query
  with dias as (
    select d::date as fecha, (d::date - 364) as base, i.pct
      from generate_series(p_desde, p_hasta, interval '1 day') d
      join public.ipc_mensual i on i.anio = extract(year from d)::int and i.mes = extract(month from d)::int
  ),
  -- semanas completas alrededor del rango base (para repartir el domingo de CFR9)
  base as (
    select v.local, v.fecha, v.total from public.ventas_locales_dia v
     where v.fecha between p_desde - 364 - 7 and p_hasta - 364 + 7 and v.local <> 'CFR4'
  ),
  cfr9 as (
    select b.fecha, b.total, date_trunc('week', b.fecha)::date as semana, extract(isodow from b.fecha)::int as dow
      from base b where b.local = 'CFR9'
  ),
  domingo as (select c.semana, sum(c.total) as dom from cfr9 c where c.dow = 7 group by c.semana),
  lunsab as (select c.semana, sum(c.total) as s, count(*) as n from cfr9 c where c.dow < 7 group by c.semana),
  cfr4 as (
    select 'CFR4'::text as local, c.fecha,
           c.total + coalesce(d.dom, 0) * case when l.s <> 0 then c.total / l.s else 1.0 / nullif(l.n, 0) end as total
      from cfr9 c
      left join domingo d on d.semana = c.semana
      left join lunsab l on l.semana = c.semana
     where c.dow < 7
  ),
  todas as (select * from base union all select * from cfr4),
  locs as (select distinct t.local from todas t)
  select l.local, d.fecha, d.base, t.total, d.pct,
         round(t.total * (1 + d.pct / 100), 2),
         coalesce(t.total, 0) <> 0
    from dias d
   cross join locs l
    left join todas t on t.local = l.local and t.fecha = d.base
   order by l.local, d.fecha;
end $$;
revoke all on function public.objetivos_locales_dia(date, date) from public, anon;
grant execute on function public.objetivos_locales_dia(date, date) to authenticated, service_role;
