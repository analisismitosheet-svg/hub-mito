-- =====================================================
-- TESORERÍA → ARQUEOS DE LOCALES (12/11/2026)
--
-- Los arqueos de caja de Dragon (DWH.dbo.vw_FACT_ARQUEO, solo lectura) los copia el
-- puente cada 2 minutos (puente-sql/scripts/sync-arqueos.js → arqueos_sync_filas).
-- Se guarda una fila por arqueo con el detalle en pesos por billete/moneda (jsonb).
--
-- Horarios fijos: 10, 14, 19 y 22 h. Un arqueo vale para el horario si se hace desde
-- 1 h 30 antes hasta 1 h después (el de las 14 vale entre 12:30 y 15:00).
-- Si 15 min después del horario no hay arqueo, el local recibe un aviso (cartel en el hub
-- + push al celular) y se repite cada 15 min hasta que arquee o se cierre el horario.
-- Lo manda /api/push?tipo=arqueo, que llama el puente después de cada sync y que toma los
-- avisos con arqueos_avisos_tomar() (solo service role).
--
-- Permisos:
--   arqueos.view  rol tesoreria   ve todos los locales
--   arqueos.edit                  saca o vuelve a sumar un local a los avisos
--   Cada cuenta de local (usuarios.local) ve solo lo suyo.
-- Idempotente.
-- =====================================================

insert into public.permisos (clave, modulo, accion, label, orden) values
  ('arqueos.view', 'arqueos', 'view', 'Ver Arqueos de locales (efectivo por billete de todos los locales)', 1520),
  ('arqueos.edit', 'arqueos', 'edit', 'Arqueos de locales: sacar o volver a sumar locales a los avisos', 1521)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;

insert into public.rol_permisos (rol, permiso_clave) values
  ('tesoreria', 'arqueos.view'),
  ('tesoreria', 'arqueos.edit')
on conflict do nothing;

-- ---------- Arqueos (copia de Dragon) ----------
create table if not exists public.arqueos_locales (
  local text not null,              -- código de public.locales
  caja int not null,
  arqueo int not null,
  fecha date not null,              -- hora local (Córdoba), como viene de Dragon
  hora time not null,
  vendedor text,
  total numeric not null default 0, -- efectivo en pesos
  billetes jsonb not null default '[]'::jsonb, -- [{tipo, valor, cant, tot}]
  actualizado_at timestamptz not null default now(),
  primary key (local, caja, arqueo)
);
create index if not exists arqueos_locales_fecha on public.arqueos_locales (fecha, local);
alter table public.arqueos_locales enable row level security;
drop policy if exists arqueos_locales_ver on public.arqueos_locales;
create policy arqueos_locales_ver on public.arqueos_locales for select to authenticated
  using (private.tengo_permiso('arqueos.view') or local = private.mi_local());
revoke insert, update, delete on public.arqueos_locales from anon, authenticated;

-- Locales que no reciben avisos (cerrados, en obra, etc.)
create table if not exists public.arqueos_excluidos (
  local text primary key,
  por text,
  at timestamptz not null default now()
);
alter table public.arqueos_excluidos enable row level security;
drop policy if exists arqueos_excluidos_ver on public.arqueos_excluidos;
create policy arqueos_excluidos_ver on public.arqueos_excluidos for select to authenticated
  using (private.tengo_permiso('arqueos.view') or local = private.mi_local());
revoke insert, update, delete on public.arqueos_excluidos from anon, authenticated;

-- Última corrida del sync (si está viejo no se avisa: los datos no son confiables)
create table if not exists public.arqueos_sync_estado (
  id int primary key default 1 check (id = 1),
  ultimo_at timestamptz
);
insert into public.arqueos_sync_estado (id) values (1) on conflict do nothing;
alter table public.arqueos_sync_estado enable row level security;
drop policy if exists arqueos_sync_estado_ver on public.arqueos_sync_estado;
create policy arqueos_sync_estado_ver on public.arqueos_sync_estado for select to authenticated using (true);
revoke insert, update, delete on public.arqueos_sync_estado from anon, authenticated;

-- Avisos mandados (uno por local, día y horario; se repite cada 15 min)
create table if not exists public.arqueos_avisos (
  local text not null,
  fecha date not null,
  horario int not null,
  avisos int not null default 0,
  ultimo_at timestamptz not null default now(),
  primary key (local, fecha, horario)
);
alter table public.arqueos_avisos enable row level security;
revoke all on public.arqueos_avisos from anon, authenticated;

-- ---------- Sync desde el puente ----------
-- p_filas: [{local, caja, arqueo, fecha, hora, vendedor, total, billetes}] de p_desde en adelante.
-- Lo que ya no está en Dragon desde p_desde se borra (solo acá, nunca en SQL Server).
create or replace function public.arqueos_sync_filas(p_token text, p_desde date, p_filas jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  with f as (
    select upper(btrim(e->>'local')) as local, (e->>'caja')::int as caja, (e->>'arqueo')::int as arqueo,
           (e->>'fecha')::date as fecha, (e->>'hora')::time as hora, nullif(btrim(e->>'vendedor'), '') as vendedor,
           coalesce((e->>'total')::numeric, 0) as total, coalesce(e->'billetes', '[]'::jsonb) as billetes
      from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) e
     where nullif(btrim(e->>'local'), '') is not null and e->>'fecha' ~ '^\d{4}-\d{2}-\d{2}$'
  )
  insert into public.arqueos_locales (local, caja, arqueo, fecha, hora, vendedor, total, billetes, actualizado_at)
  select local, caja, arqueo, fecha, hora, vendedor, total, billetes, now() from f
  on conflict (local, caja, arqueo) do update
    set fecha = excluded.fecha, hora = excluded.hora, vendedor = excluded.vendedor, total = excluded.total,
        billetes = excluded.billetes, actualizado_at = now()
    where (arqueos_locales.fecha, arqueos_locales.hora, arqueos_locales.total, arqueos_locales.billetes)
          is distinct from (excluded.fecha, excluded.hora, excluded.total, excluded.billetes);
  get diagnostics n = row_count;

  if p_desde is not null then
    delete from public.arqueos_locales a
     where a.fecha >= p_desde
       and not exists (select 1 from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) e
                        where upper(btrim(e->>'local')) = a.local and (e->>'caja')::int = a.caja and (e->>'arqueo')::int = a.arqueo);
  end if;
  delete from public.arqueos_locales where fecha < current_date - 90;
  delete from public.arqueos_avisos where fecha < current_date - 7;
  update public.arqueos_sync_estado set ultimo_at = now() where id = 1;
  return n;
end $$;
revoke all on function public.arqueos_sync_filas(text, date, jsonb) from public;
grant execute on function public.arqueos_sync_filas(text, date, jsonb) to anon, authenticated;

-- ---------- Sacar / sumar un local a los avisos ----------
create or replace function public.arqueos_excluir(p_local text, p_excluir boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.tengo_permiso('arqueos.edit') then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_excluir then
    insert into public.arqueos_excluidos (local, por)
    values (upper(btrim(p_local)), (select coalesce(nombre, email) from public.usuarios where id = auth.uid()))
    on conflict (local) do nothing;
  else
    delete from public.arqueos_excluidos where local = upper(btrim(p_local));
  end if;
end $$;
revoke all on function public.arqueos_excluir(text, boolean) from public;
grant execute on function public.arqueos_excluir(text, boolean) to authenticated;

-- ---------- Avisos que tocan ahora (lo usa /api/push?tipo=arqueo con service role) ----------
-- Devuelve local + horario que están entre 15 y 60 min pasado el horario sin arqueo válido,
-- cuyo último aviso fue hace 14 min o más, y los anota. Cuenta solo los locales que arquearon
-- algún día de las últimas 2 semanas y no están excluidos. Sin sync en los últimos 10 min: nada.
create or replace function public.arqueos_avisos_tomar()
returns table (local text, horario int, avisos int)
language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamp := now() at time zone 'America/Argentina/Cordoba';
  v_hoy date := v_ahora::date;
  v_min int := extract(hour from v_ahora)::int * 60 + extract(minute from v_ahora)::int;
begin
  if coalesce((select ultimo_at from public.arqueos_sync_estado where id = 1), '-infinity') < now() - interval '10 minutes' then
    return;
  end if;
  return query
  with h as (select unnest(array[10, 14, 19, 22]) as horario),
  activos as (
    select distinct a.local from public.arqueos_locales a
     where a.fecha >= v_hoy - 14
       and not exists (select 1 from public.arqueos_excluidos x where x.local = a.local)
  ),
  faltan as (
    select l.local, h.horario
      from activos l cross join h
     where v_min between h.horario * 60 + 15 and h.horario * 60 + 60
       and not exists (
         select 1 from public.arqueos_locales a
          where a.local = l.local and a.fecha = v_hoy
            and (extract(hour from a.hora)::int * 60 + extract(minute from a.hora)::int)
                between h.horario * 60 - 90 and h.horario * 60 + 60)
  ),
  anotados as (
    insert into public.arqueos_avisos as v (local, fecha, horario, avisos, ultimo_at)
    select f.local, v_hoy, f.horario, 1, now() from faltan f
    on conflict (local, fecha, horario) do update
      set avisos = v.avisos + 1, ultimo_at = now()
      where v.ultimo_at <= now() - interval '14 minutes'
    returning v.local, v.horario, v.avisos
  )
  select * from anotados;
end $$;
revoke all on function public.arqueos_avisos_tomar() from public, anon, authenticated;
grant execute on function public.arqueos_avisos_tomar() to service_role;
