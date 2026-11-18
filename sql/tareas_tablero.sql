-- =====================================================
-- ORGANIZADOR DE TAREAS tipo Trello (18/11/2026)
--
-- Tablero personal con tres columnas: idea → en marcha → hecha.
-- Cada tarjeta guarda la fecha de la idea, cuándo arrancó y cuándo se terminó
-- (las pone sola la pantalla al moverla; se pueden corregir a mano).
-- Cada uno ve sus tarjetas; el admin ve las de todos (con selector).
-- Permiso: tareas.view (rol web; el admin siempre y arranca viendo las de todos). Pantalla: src/pages/TareasTablero.tsx
-- Idempotente.
-- =====================================================

insert into public.permisos (clave, modulo, accion, label, orden) values
  ('tareas.view', 'tareas', 'view', 'Organizador de tareas (tablero propio)', 950)
on conflict (clave) do update set label = excluded.label;

create table if not exists public.tareas_tablero (
  id bigint generated always as identity primary key,
  usuario_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 300),
  nota text,
  etiqueta text not null default 'General',
  estado text not null default 'idea' check (estado in ('idea', 'marcha', 'hecha')),
  fecha_idea date not null default (now() at time zone 'America/Argentina/Cordoba')::date,
  fecha_inicio date,
  fecha_fin date,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
create index if not exists tareas_tablero_usuario on public.tareas_tablero (usuario_id, estado);

alter table public.tareas_tablero enable row level security;

drop policy if exists tareas_tablero_ver on public.tareas_tablero;
create policy tareas_tablero_ver on public.tareas_tablero for select to authenticated
  using (usuario_id = auth.uid() or private.es_admin());

drop policy if exists tareas_tablero_crear on public.tareas_tablero;
create policy tareas_tablero_crear on public.tareas_tablero for insert to authenticated
  with check (usuario_id = auth.uid() and private.tengo_permiso('tareas.view'));

drop policy if exists tareas_tablero_editar on public.tareas_tablero;
create policy tareas_tablero_editar on public.tareas_tablero for update to authenticated
  using (usuario_id = auth.uid() or private.es_admin())
  with check (usuario_id = auth.uid() or private.es_admin());

drop policy if exists tareas_tablero_borrar on public.tareas_tablero;
create policy tareas_tablero_borrar on public.tareas_tablero for delete to authenticated
  using (usuario_id = auth.uid() or private.es_admin());

grant select, insert, update, delete on public.tareas_tablero to authenticated;

create or replace function private.tareas_tablero_tocar() returns trigger
language plpgsql as $$
begin
  new.actualizado_at := now();
  return new;
end $$;
drop trigger if exists tareas_tablero_tocar on public.tareas_tablero;
create trigger tareas_tablero_tocar before update on public.tareas_tablero
  for each row execute function private.tareas_tablero_tocar();

-- Para el selector del admin: nombre de cada dueño de tarjetas
create or replace function public.tareas_tablero_duenos()
returns table (id uuid, nombre text)
language sql stable security definer set search_path = public
as $$
  select u.id, coalesce(nullif(u.nombre, ''), u.email)
  from public.usuarios u
  where private.es_admin()
    and exists (select 1 from public.tareas_tablero t where t.usuario_id = u.id)
  order by 2;
$$;
revoke all on function public.tareas_tablero_duenos() from public, anon;
grant execute on function public.tareas_tablero_duenos() to authenticated;

-- 18/11/2026: lo usan los del rol web
insert into public.rol_permisos (rol, permiso_clave) values ('web', 'tareas.view')
on conflict do nothing;
