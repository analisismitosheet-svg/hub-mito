-- ============================================================
-- Seguridad de NOVEDADES (RRHH)
-- ============================================================
-- Antes: novedades, novedades_tipos y novedades_motivos tenían políticas
-- "using (true)" para el rol public: cualquiera con la anon key (que va en
-- la app publicada) podía leer, modificar y borrar todo sin iniciar sesión.
--
-- Ahora: solo usuarios autenticados y según sus permisos de rol
-- (los mismos que usa la app con usePermisosArea('rrhh.novedades')):
--   ver     -> rrhh.novedades.view (o cualquier otro permiso de novedades)
--   crear   -> rrhh.novedades.create
--   editar  -> rrhh.novedades.edit
--   borrar  -> rrhh.novedades.delete
-- Los administradores pasan siempre (private.tiene_permiso ya lo contempla).
-- Tipos y motivos los puede LEER cualquier usuario autenticado (son catálogos).
-- ============================================================

begin;

-- ---- novedades ----
drop policy if exists "novedades lectura" on public.novedades;
drop policy if exists "novedades escritura" on public.novedades;
drop policy if exists "novedades update" on public.novedades;
drop policy if exists "novedades delete" on public.novedades;

create policy "novedades ver" on public.novedades
  for select to authenticated
  using (
    private.tiene_permiso('rrhh.novedades.view')
    or private.tiene_permiso('rrhh.novedades.create')
    or private.tiene_permiso('rrhh.novedades.edit')
    or private.tiene_permiso('rrhh.novedades.delete')
  );

create policy "novedades crear" on public.novedades
  for insert to authenticated
  with check (private.tiene_permiso('rrhh.novedades.create'));

create policy "novedades editar" on public.novedades
  for update to authenticated
  using (private.tiene_permiso('rrhh.novedades.edit'))
  with check (private.tiene_permiso('rrhh.novedades.edit'));

create policy "novedades borrar" on public.novedades
  for delete to authenticated
  using (private.tiene_permiso('rrhh.novedades.delete'));

-- ---- novedades_tipos ----
drop policy if exists "novedades_tipos lectura" on public.novedades_tipos;
drop policy if exists "novedades_tipos escritura" on public.novedades_tipos;
drop policy if exists "novedades_tipos update" on public.novedades_tipos;
drop policy if exists "novedades_tipos delete" on public.novedades_tipos;

create policy "novedades_tipos ver" on public.novedades_tipos
  for select to authenticated using (true);
create policy "novedades_tipos crear" on public.novedades_tipos
  for insert to authenticated with check (private.tiene_permiso('rrhh.novedades.create'));
create policy "novedades_tipos editar" on public.novedades_tipos
  for update to authenticated
  using (private.tiene_permiso('rrhh.novedades.edit'))
  with check (private.tiene_permiso('rrhh.novedades.edit'));
create policy "novedades_tipos borrar" on public.novedades_tipos
  for delete to authenticated using (private.tiene_permiso('rrhh.novedades.delete'));

-- ---- novedades_motivos ----
drop policy if exists "novedades_motivos lectura" on public.novedades_motivos;
drop policy if exists "novedades_motivos escritura" on public.novedades_motivos;
drop policy if exists "novedades_motivos update" on public.novedades_motivos;
drop policy if exists "novedades_motivos delete" on public.novedades_motivos;

create policy "novedades_motivos ver" on public.novedades_motivos
  for select to authenticated using (true);
create policy "novedades_motivos crear" on public.novedades_motivos
  for insert to authenticated with check (private.tiene_permiso('rrhh.novedades.create'));
create policy "novedades_motivos editar" on public.novedades_motivos
  for update to authenticated
  using (private.tiene_permiso('rrhh.novedades.edit'))
  with check (private.tiene_permiso('rrhh.novedades.edit'));
create policy "novedades_motivos borrar" on public.novedades_motivos
  for delete to authenticated using (private.tiene_permiso('rrhh.novedades.delete'));

commit;
