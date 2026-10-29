-- ============================================================================
-- Locales → Objetivos (28/10/2026)
--
-- Objetivo de venta por local y por día, que se arma solo cuando se carga el IPC del mes:
--   Objetivo_2026(fecha) = Venta_2025(fecha − 364 días) × IPC acumulado de 12 meses
--   (el producto de (1 + IPC mensual) de los 12 meses que terminan en el mes de objetivos),
--   o el IPC interanual de ese mes si se cargó directo (tiene prioridad)
--   (364 días = 52 semanas: el día de la semana coincide siempre)
--   El mes de objetivos va del 26 al 25: del 26/10 al 25/11 son los objetivos de noviembre
--   y usan el IPC de noviembre.
--
-- Quién ve qué: el admin ve todos los locales, el comparativo, el IPC y los feriados. El
-- resto (con objetivos.view) ve solo el local de su usuario (usuarios.local).
-- Feriados: objetivos_feriados (fecha + local, o todos los locales): ese día no hay objetivo.
--
-- CFR4 (Captain Fin Río 4, abrió en nov-2025) se regenera desde CFR9: por cada semana ISO
-- de 2025, el domingo de CFR9 se reparte entre lunes y sábado en proporción a la venta de
-- cada día. CFR4 = CFR9 sin domingos, con el mismo total semanal (domingo cerrado).
--
-- Venta = tickets + facturas electrónicas netos (TICKET%, FACTURAELECTRONICA% y
-- NOTADECREDITOELECTRONICA% no anulados, las notas de crédito restan), como el Excel de objetivos. La sube el puente: puente-sql/scripts/sync-ventas-locales.js.
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
  using (private.es_admin() or private.tengo_permiso('conversion.view')
         or (private.tengo_permiso('objetivos.view') and upper(local) = upper(coalesce(private.mi_local(), ''))));

-- IPC mensual (%), lo carga la pantalla
create table if not exists public.ipc_mensual (
  anio integer not null,
  mes integer not null check (mes between 1 and 12),
  pct numeric not null check (pct > -50 and pct < 100),
  cargado_por uuid default auth.uid(),
  actualizado_at timestamptz not null default now(),
  primary key (anio, mes)
);
-- Por mes se carga el IPC mensual (pct), el interanual (interanual) o los dos.
alter table public.ipc_mensual alter column pct drop not null;
alter table public.ipc_mensual add column if not exists interanual numeric check (interanual > -50 and interanual < 1000);
alter table public.ipc_mensual drop constraint if exists ipc_mensual_algo;
alter table public.ipc_mensual add constraint ipc_mensual_algo check (pct is not null or interanual is not null);
alter table public.ipc_mensual enable row level security;
drop policy if exists ipc_mensual_ver on public.ipc_mensual;
create policy ipc_mensual_ver on public.ipc_mensual for select to authenticated
  using (private.es_admin());
drop policy if exists ipc_mensual_editar on public.ipc_mensual;
create policy ipc_mensual_editar on public.ipc_mensual for all to authenticated
  using (private.es_admin()) with check (private.es_admin());

-- Feriados sin objetivo (local null = todos los locales). Los carga el admin.
create table if not exists public.objetivos_feriados (
  id bigint generated always as identity primary key,
  fecha date not null,
  local text,
  motivo text,
  creado_por uuid default auth.uid(),
  creado_at timestamptz not null default now()
);
create unique index if not exists objetivos_feriados_uq on public.objetivos_feriados (fecha, coalesce(local, '*'));
alter table public.objetivos_feriados enable row level security;
drop policy if exists objetivos_feriados_ver on public.objetivos_feriados;
create policy objetivos_feriados_ver on public.objetivos_feriados for select to authenticated
  using (private.tengo_permiso('objetivos.view'));
drop policy if exists objetivos_feriados_editar on public.objetivos_feriados;
create policy objetivos_feriados_editar on public.objetivos_feriados for all to authenticated
  using (private.es_admin()) with check (private.es_admin());

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

-- Objetivos cargados a mano (por ahora, el Excel que se hacía antes: G:\Mi unidad\objetivos.xlsx).
-- Si un local tiene objetivos cargados en un mes de objetivos (26 al 25), ese mes usa solo los
-- cargados: el día que no tiene uno queda sin objetivo (no se calcula con el IPC).
create table if not exists public.objetivos_cargados (
  local text not null,
  fecha date not null,
  monto numeric not null,
  origen text,
  cargado_at timestamptz not null default now(),
  primary key (local, fecha)
);
alter table public.objetivos_cargados enable row level security;
drop policy if exists objetivos_cargados_ver on public.objetivos_cargados;
create policy objetivos_cargados_ver on public.objetivos_cargados for select to authenticated
  using (private.es_admin());
drop policy if exists objetivos_cargados_editar on public.objetivos_cargados;
create policy objetivos_cargados_editar on public.objetivos_cargados for all to authenticated
  using (private.es_admin()) with check (private.es_admin());

-- ---------------------------------------------------------------------------
-- Objetivos y venta por local y día del rango. Salen los días con objetivo cargado o cuyo
-- mes de objetivos (26 al 25) tiene IPC: el interanual de ese mes o los 12 mensuales.
--   ipc        = IPC que se aplica a la venta base (%)
--   venta_base = venta del día base (fecha − 364); para CFR4, la generada desde CFR9
--   opera      = el local vendió ese día base; en un mes con objetivos cargados, que tenga uno ese día
--                (si no: «no abre», sin objetivo)
--   feriado    = cargado en objetivos_feriados: sin objetivo
--   manual     = el objetivo viene de objetivos_cargados, no del cálculo
--   venta      = venta real del día (tickets netos)
-- p_local: solo el admin puede pedir cualquier local (null = todos); el resto ve el suyo.
-- ---------------------------------------------------------------------------
drop function if exists public.objetivos_locales_dia(date, date);
drop function if exists public.objetivos_locales_dia(date, date, text);
create or replace function public.objetivos_locales_dia(p_desde date, p_hasta date, p_local text default null)
returns table (local text, fecha date, fecha_base date, venta_base numeric, ipc numeric, objetivo numeric,
               opera boolean, feriado boolean, venta numeric, manual boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_local text;
begin
  if auth.role() = 'service_role' or private.es_admin() then
    v_local := nullif(upper(btrim(p_local)), '');
  elsif private.tengo_permiso('objetivos.view') then
    v_local := upper(btrim(private.mi_local()));
    if v_local is null or v_local = '' then
      raise exception 'Tu usuario no tiene un local asignado' using errcode = '42501';
    end if;
  else
    raise exception 'Sin permiso para ver los objetivos' using errcode = '42501';
  end if;
  if p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Rango inválido (máximo 400 días)';
  end if;
  return query
  with dias as (
    -- Interanual del mes de objetivos si está cargado; si no, el acumulado de los 12 IPC
    -- mensuales que terminan en él (null si falta alguno).
    select d::date as fecha, (d::date - 364) as base, m.mes_obj,
           coalesce(ia.interanual, case when a.n = 12 then a.pct end) as pct
      from generate_series(p_desde, p_hasta, interval '1 day') d
      cross join lateral (select (date_trunc('month', d) + case when extract(day from d) >= 26 then interval '1 month' else interval '0' end)::date as mes_obj) m
      left join public.ipc_mensual ia on ia.anio = extract(year from m.mes_obj)::int and ia.mes = extract(month from m.mes_obj)::int
      cross join lateral (
        select round((exp(sum(ln(1 + i.pct / 100))) - 1) * 100, 4) as pct, count(i.pct) as n
          from public.ipc_mensual i
         where make_date(i.anio, i.mes, 1) between (m.mes_obj - interval '11 months')::date and m.mes_obj
      ) a
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
  cargados as (
    select upper(o.local) as local, o.fecha, o.monto,
           (date_trunc('month', o.fecha) + case when extract(day from o.fecha) >= 26 then interval '1 month' else interval '0' end)::date as mes_obj
      from public.objetivos_cargados o
     where o.fecha between p_desde - 31 and p_hasta + 31
  ),
  -- local y mes de objetivos con objetivos cargados: ahí no se calcula nada (día sin cargar = sin objetivo)
  meses_cargados as (select distinct c.local, c.mes_obj from cargados c),
  locs as (
    select x.local from (select t.local from todas t union select c.local from cargados c) x
     where v_local is null or x.local = v_local
  ),
  armado as (
    select l.local, d.fecha, d.base, t.total as vb, d.pct, c.monto, mc.local is not null as mes_cargado,
           case when mc.local is not null then coalesce(c.monto, 0) <> 0 else coalesce(t.total, 0) <> 0 end as opera,
           exists (select 1 from public.objetivos_feriados f
                    where f.fecha = d.fecha and (f.local is null or upper(f.local) = l.local)) as feriado
      from dias d
     cross join locs l
      left join todas t on t.local = l.local and t.fecha = d.base
      left join cargados c on c.local = l.local and c.fecha = d.fecha
      left join meses_cargados mc on mc.local = l.local and mc.mes_obj = d.mes_obj
     where d.pct is not null or mc.local is not null
  )
  select a.local, a.fecha, a.base, a.vb, a.pct,
         case when a.feriado then null
              when a.mes_cargado then a.monto
              when a.opera and a.pct is not null then round(a.vb * (1 + a.pct / 100), 2) end,
         a.opera, a.feriado, v.total, a.monto is not null
    from armado a
    left join public.ventas_locales_dia v on v.local = a.local and v.fecha = a.fecha
   order by a.local, a.fecha;
end $$;
revoke all on function public.objetivos_locales_dia(date, date, text) from public, anon;
grant execute on function public.objetivos_locales_dia(date, date, text) to authenticated, service_role;
