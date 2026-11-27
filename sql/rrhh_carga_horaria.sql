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
