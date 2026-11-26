-- Administración > Flexxus — clasificación propia de las cuentas contables (26/11/2026)
--
-- A cada número de cuenta de Flexxus se le asigna una Clasificación, un Rubro y una
-- Nota (los tres niveles de la planilla del contador, ej. «01. Activo Corriente» →
-- «01. Caja y Bancos» → «Bancos»). Sumas y saldos puede agrupar por acá en vez de
-- por el plan de cuentas de Flexxus. Flexxus no se toca: esto vive solo en el hub.
--
-- Ver: flexxus.view. Editar: flexxus.clasificar (los admins pasan siempre).

insert into public.permisos (clave, modulo, accion, label, orden)
values ('flexxus.clasificar', 'flexxus', 'clasificar', 'Flexxus · asignar clasificación a las cuentas', 1506)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;

create table if not exists public.flexxus_clasificacion (
  cuenta text primary key check (cuenta ~ '^\d{1,12}$'),
  clasificacion text not null default '',
  rubro text not null default '',
  nota text not null default '',
  actualizado_por uuid default auth.uid(),
  actualizado_en timestamptz not null default now()
);

alter table public.flexxus_clasificacion enable row level security;

drop policy if exists flexxus_clasificacion_ver on public.flexxus_clasificacion;
create policy flexxus_clasificacion_ver on public.flexxus_clasificacion for select to authenticated
  using ((select private.tengo_permiso('flexxus.view')));

drop policy if exists flexxus_clasificacion_alta on public.flexxus_clasificacion;
create policy flexxus_clasificacion_alta on public.flexxus_clasificacion for insert to authenticated
  with check ((select private.tengo_permiso('flexxus.clasificar')));

drop policy if exists flexxus_clasificacion_cambio on public.flexxus_clasificacion;
create policy flexxus_clasificacion_cambio on public.flexxus_clasificacion for update to authenticated
  using ((select private.tengo_permiso('flexxus.clasificar')))
  with check ((select private.tengo_permiso('flexxus.clasificar')));

drop policy if exists flexxus_clasificacion_baja on public.flexxus_clasificacion;
create policy flexxus_clasificacion_baja on public.flexxus_clasificacion for delete to authenticated
  using ((select private.tengo_permiso('flexxus.clasificar')));

revoke all on public.flexxus_clasificacion from anon;
grant select, insert, update, delete on public.flexxus_clasificacion to authenticated;

-- Quién y cuándo cambió por última vez
create or replace function private.flexxus_clasificacion_tocar()
returns trigger language plpgsql set search_path = public as $$
begin
  new.actualizado_por := auth.uid();
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists flexxus_clasificacion_tocar on public.flexxus_clasificacion;
create trigger flexxus_clasificacion_tocar before insert or update on public.flexxus_clasificacion
  for each row execute function private.flexxus_clasificacion_tocar();
