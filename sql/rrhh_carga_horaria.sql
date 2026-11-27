-- =====================================================
-- RR. HH. → Carga horaria (27/11/2026)
-- Planilla tipo calendario: horario de cada legajo, día por día.
-- Una fila por legajo y fecha. `horario` es lo que se tipeó normalizado
-- ("10:00-14:00 17:00-21:00"), `horas` el total del día y `tipo`:
--   trabajo | franco | vacaciones | licencia
-- `local` = local del empleado al momento de cargar (lugar o, si dice
-- LOCALES, area_sector) para poder sumar por local aunque después se mude.
-- Pantalla: src/pages/CargaHoraria.tsx (/rrhh/carga-horaria).
-- =====================================================

create table if not exists public.rrhh_carga_horaria (
  id bigint generated always as identity primary key,
  legajo text not null,
  fecha date not null,
  local text,
  horario text,
  horas numeric(5,2) not null default 0,
  tipo text not null default 'trabajo' check (tipo in ('trabajo', 'franco', 'vacaciones', 'licencia')),
  actualizado_por uuid default auth.uid(),
  actualizado_at timestamptz not null default now(),
  unique (legajo, fecha)
);
create index if not exists rrhh_carga_horaria_fecha on public.rrhh_carga_horaria (fecha);
create index if not exists rrhh_carga_horaria_local_fecha on public.rrhh_carga_horaria (local, fecha);
alter table public.rrhh_carga_horaria enable row level security;

insert into public.permisos (clave, modulo, accion, label, orden) values
  ('rrhh.horarios.view', 'rrhh', 'view', 'Ver la carga horaria por local y legajo', 870),
  ('rrhh.horarios.edit', 'rrhh', 'edit', 'Cargar y cambiar la carga horaria', 871)
on conflict (clave) do nothing;
insert into public.rol_permisos (rol, permiso_clave) values
  ('rr_hh', 'rrhh.horarios.view'), ('rr_hh', 'rrhh.horarios.edit')
on conflict do nothing;

drop policy if exists rrhh_carga_horaria_ver on public.rrhh_carga_horaria;
create policy rrhh_carga_horaria_ver on public.rrhh_carga_horaria for select to authenticated
  using (private.es_admin() or private.tengo_permiso('rrhh.horarios.view'));
drop policy if exists rrhh_carga_horaria_editar on public.rrhh_carga_horaria;
create policy rrhh_carga_horaria_editar on public.rrhh_carga_horaria for all to authenticated
  using (private.es_admin() or private.tengo_permiso('rrhh.horarios.edit'))
  with check (private.es_admin() or private.tengo_permiso('rrhh.horarios.edit'));

-- Apertura de cada local para la planilla (27/11/2026): días y horario.
-- Con eso se marca en rojo quien entra después de abrir o sale antes de cerrar,
-- y se cuenta cuántas personas hay al abrir y al cerrar.
create table if not exists public.rrhh_locales_apertura (
  local text primary key,
  dias text not null default 'lunes a domingos',
  abre text not null default '10:00',
  cierra text not null default '21:00',
  actualizado_at timestamptz not null default now()
);
alter table public.rrhh_locales_apertura enable row level security;
drop policy if exists rrhh_locales_apertura_ver on public.rrhh_locales_apertura;
create policy rrhh_locales_apertura_ver on public.rrhh_locales_apertura for select to authenticated
  using (private.es_admin() or private.tengo_permiso('rrhh.horarios.view'));
drop policy if exists rrhh_locales_apertura_editar on public.rrhh_locales_apertura;
create policy rrhh_locales_apertura_editar on public.rrhh_locales_apertura for all to authenticated
  using (private.es_admin() or private.tengo_permiso('rrhh.horarios.edit'))
  with check (private.es_admin() or private.tengo_permiso('rrhh.horarios.edit'));

-- =====================================================
-- 27/11/2026: modificar la carga horaria es solo del admin y del rol rr_hh
-- (no alcanza con dar el permiso rrhh.horarios.edit a otro rol).
-- Marcaciones del reloj (pantalla RR. HH. → Marcaciones, se suben de un Excel).
-- =====================================================
create or replace function private.es_rrhh()
returns boolean language sql stable security definer set search_path = public as $$
  select private.es_admin()
      or exists (select 1 from public.usuario_roles ur where ur.usuario_id = auth.uid() and ur.rol_codigo = 'rr_hh')
$$;

drop policy if exists rrhh_carga_horaria_editar on public.rrhh_carga_horaria;
create policy rrhh_carga_horaria_editar on public.rrhh_carga_horaria for all to authenticated
  using (private.es_rrhh()) with check (private.es_rrhh());
drop policy if exists rrhh_locales_apertura_editar on public.rrhh_locales_apertura;
create policy rrhh_locales_apertura_editar on public.rrhh_locales_apertura for all to authenticated
  using (private.es_rrhh()) with check (private.es_rrhh());
delete from public.rol_permisos where permiso_clave = 'rrhh.horarios.edit';
delete from public.usuario_permisos where permiso_clave = 'rrhh.horarios.edit';
delete from public.permisos where clave = 'rrhh.horarios.edit';

-- Marcaciones: una fila por legajo y día. `marcas` = las fichadas del reloj tal cual ("09:58 14:02 16:59 21:03"),
-- `horario` = tramos armados de a pares, `incompleta` = quedó una fichada sin pareja.
create table if not exists public.rrhh_marcaciones (
  id bigint generated always as identity primary key,
  legajo text not null,
  fecha date not null,
  local text,
  marcas text,
  horario text,
  horas numeric(5,2) not null default 0,
  incompleta boolean not null default false,
  archivo text,
  cargado_por uuid default auth.uid(),
  cargado_at timestamptz not null default now(),
  unique (legajo, fecha)
);
create index if not exists rrhh_marcaciones_fecha on public.rrhh_marcaciones (fecha);
alter table public.rrhh_marcaciones enable row level security;
insert into public.permisos (clave, modulo, accion, label, orden) values
  ('rrhh.marcaciones.view', 'rrhh', 'view', 'Ver las marcaciones del reloj', 872)
on conflict (clave) do nothing;
insert into public.rol_permisos (rol, permiso_clave) values ('rr_hh', 'rrhh.marcaciones.view') on conflict do nothing;
drop policy if exists rrhh_marcaciones_ver on public.rrhh_marcaciones;
create policy rrhh_marcaciones_ver on public.rrhh_marcaciones for select to authenticated
  using (private.es_admin() or private.tengo_permiso('rrhh.marcaciones.view'));
drop policy if exists rrhh_marcaciones_editar on public.rrhh_marcaciones;
create policy rrhh_marcaciones_editar on public.rrhh_marcaciones for all to authenticated
  using (private.es_rrhh()) with check (private.es_rrhh());
