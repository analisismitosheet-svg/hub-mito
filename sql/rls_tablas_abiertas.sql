-- ============================================================
-- Cierra 4 tablas que estaban abiertas al público (using/with check true
-- para el rol public): cualquiera con la anon key podía leer y modificar.
-- Ver también: novedades_rls_seguro.sql
-- ============================================================
--  notas_credito      -> mayorista (pantalla Notas de crédito, campana) y
--                        polo52/mayorista desde Guías (crea/actualiza la NC de la guía)
--  app_areas,
--  app_area_acciones  -> leer: cualquier usuario autenticado (arman el menú)
--                        escribir: solo admins (pantalla Roles)
--  historial          -> leer y registrar: usuarios autenticados
-- Los admins pasan siempre (private.tiene_permiso / private.es_admin).
-- ============================================================

begin;

-- ---- notas_credito ----
drop policy if exists "notas credito lectura" on public.notas_credito;
drop policy if exists "notas credito escritura" on public.notas_credito;
drop policy if exists "notas credito update" on public.notas_credito;
drop policy if exists "notas credito delete" on public.notas_credito;

create policy "notas_credito ver" on public.notas_credito
  for select to authenticated
  using (
    private.tiene_permiso('mayorista.notas_credito.view')
    or private.tiene_permiso('mayorista.guias.view')
    or private.tiene_permiso('mayorista.guias.read')
  );

create policy "notas_credito crear" on public.notas_credito
  for insert to authenticated
  with check (
    private.tiene_permiso('mayorista.notas_credito.create')
    or private.tiene_permiso('mayorista.guias.create')
    or private.tiene_permiso('mayorista.guias.edit')
    or private.tiene_permiso('mayorista.guias.update')
  );

create policy "notas_credito editar" on public.notas_credito
  for update to authenticated
  using (
    private.tiene_permiso('mayorista.notas_credito.edit')
    or private.tiene_permiso('mayorista.guias.create')
    or private.tiene_permiso('mayorista.guias.edit')
    or private.tiene_permiso('mayorista.guias.update')
  )
  with check (
    private.tiene_permiso('mayorista.notas_credito.edit')
    or private.tiene_permiso('mayorista.guias.create')
    or private.tiene_permiso('mayorista.guias.edit')
    or private.tiene_permiso('mayorista.guias.update')
  );

create policy "notas_credito borrar" on public.notas_credito
  for delete to authenticated
  using (private.tiene_permiso('mayorista.notas_credito.delete'));

-- ---- app_areas ----
drop policy if exists "app_areas lectura" on public.app_areas;
drop policy if exists "app_areas escritura" on public.app_areas;
drop policy if exists "app_areas update" on public.app_areas;
drop policy if exists "app_areas delete" on public.app_areas;

create policy "app_areas ver" on public.app_areas
  for select to authenticated using (true);
create policy "app_areas admin" on public.app_areas
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

-- ---- app_area_acciones ----
drop policy if exists "app_area_acciones lectura" on public.app_area_acciones;
drop policy if exists "app_area_acciones escritura" on public.app_area_acciones;
drop policy if exists "app_area_acciones update" on public.app_area_acciones;
drop policy if exists "app_area_acciones delete" on public.app_area_acciones;

create policy "app_area_acciones ver" on public.app_area_acciones
  for select to authenticated using (true);
create policy "app_area_acciones admin" on public.app_area_acciones
  for all to authenticated using (private.es_admin()) with check (private.es_admin());

-- ---- historial ----
drop policy if exists "historial publico de lectura" on public.historial;
drop policy if exists "historial publico de escritura" on public.historial;

create policy "historial ver" on public.historial
  for select to authenticated using (true);
create policy "historial registrar" on public.historial
  for insert to authenticated with check (true);

commit;
