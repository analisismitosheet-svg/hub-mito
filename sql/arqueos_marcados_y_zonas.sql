-- =====================================================
-- ARQUEOS: «YA LO HICE» DEL LOCAL + ZONAS DE TESORERÍA (12/11/2026)
--
-- 1) Dragon (DWH.vw_FACT_ARQUEO) muestra el arqueo hasta 1 h después de hecho, así que
--    el aviso le seguía saltando al local que ya había arqueado. Ahora «Ya lo hice» anota
--    el horario en arqueos_marcados y eso corta el aviso (cartel y push). En Tesorería se
--    ve «marcado» hasta que el arqueo llega de Dragon.
-- 2) Zonas de los locales como las usa Tesorería: CENTRO, NORTE, SUR, OESTE, CARLOS PAZ
--    y RIO CUARTO (CFR4 sola). Se van ESTE e INTERIOR.
-- Idempotente.
-- =====================================================

-- ---------- Zonas ----------
alter table public.locales drop constraint if exists locales_zona_valida;
update public.locales l set zona = v.zona
  from (values
    ('CFPO', 'CENTRO'), ('9DEJULIO', 'CENTRO'), ('GPAZD', 'CENTRO'), ('MUNOZ', 'CENTRO'),
    ('LIBERD', 'NORTE'), ('RIVERAD', 'NORTE'), ('BUSTOD', 'NORTE'), ('CFD', 'NORTE'), ('CFRA', 'NORTE'),
    ('ESPINOD', 'SUR'), ('NVOCED', 'SUR'), ('RUTA9D2', 'SUR'), ('DINOD', 'SUR'), ('CFR9', 'SUR'),
    ('WALMARTD', 'OESTE'),
    ('VCPD', 'CARLOS PAZ'),
    ('CFR4', 'RIO CUARTO')
  ) as v(codigo, zona)
 where l.codigo = v.codigo;
update public.locales set zona = null where zona in ('ESTE', 'INTERIOR');
alter table public.locales add constraint locales_zona_valida
  check (zona is null or zona in ('CENTRO', 'NORTE', 'SUR', 'OESTE', 'CARLOS PAZ', 'RIO CUARTO'));

-- ---------- «Ya lo hice» ----------
create table if not exists public.arqueos_marcados (
  local text not null,
  fecha date not null,
  horario int not null,
  por text,
  at timestamptz not null default now(),
  primary key (local, fecha, horario)
);
alter table public.arqueos_marcados enable row level security;
drop policy if exists arqueos_marcados_ver on public.arqueos_marcados;
create policy arqueos_marcados_ver on public.arqueos_marcados for select to authenticated
  using (private.tengo_permiso('arqueos.view') or local = private.mi_local());
revoke insert, update, delete on public.arqueos_marcados from anon, authenticated;

-- El local de la cuenta marca un horario de hoy (solo 10/14/19/22 y desde 1 h 30 antes).
create or replace function public.arqueos_marcar(p_horario int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_local text := upper(btrim(private.mi_local()));
  v_ahora timestamp := now() at time zone 'America/Argentina/Cordoba';
  v_min int := extract(hour from v_ahora)::int * 60 + extract(minute from v_ahora)::int;
begin
  if coalesce(v_local, '') = '' then
    raise exception 'La cuenta no es de un local' using errcode = '42501';
  end if;
  if p_horario not in (10, 14, 19, 22) or v_min < p_horario * 60 - 90 then
    raise exception 'Horario inválido' using errcode = '22023';
  end if;
  insert into public.arqueos_marcados (local, fecha, horario, por)
  values (v_local, v_ahora::date, p_horario, (select coalesce(nombre, email) from public.usuarios where id = auth.uid()))
  on conflict (local, fecha, horario) do nothing;
end $$;
revoke all on function public.arqueos_marcar(int) from public;
grant execute on function public.arqueos_marcar(int) to authenticated;

-- Avisos: un horario marcado no se avisa más.
create or replace function public.arqueos_avisos_tomar()
returns table (local text, horario int, avisos int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
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
       and not exists (select 1 from public.arqueos_marcados m
                        where m.local = l.local and m.fecha = v_hoy and m.horario = h.horario)
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
