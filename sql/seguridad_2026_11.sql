-- =====================================================
-- Revisión de seguridad (26/11/2026). Bloques #1 a #4 APLICADOS el 26/11/2026 (probado:
-- cuenta nueva ve 0; mayorista y polo52 ven clientes/guías/facturación; depósito ve Pacho).
-- Bloques #5 a #8 APLICADOS el 26/11/2026 (probado: cuenta nueva sin permisos ni catálogos,
-- roles reales igual que antes, oc_reparto bloqueada para anon).
-- Idempotente. Cada bloque = un hallazgo (numeración igual al informe).
-- Contexto: el registro es abierto y sin confirmación de mail. Una cuenta recién
-- creada (estado 'pendiente', sin roles) hoy lee clientes, guías, facturación,
-- proveedores e historial, y puede modificarlos o borrarlos.
-- Regla: private.tiene_permiso() ya exige usuario aprobado (admins pasan siempre).
-- =====================================================

begin;

-- ---- #1 clientes (CRÍTICO): 513 clientes con teléfono y dirección, CRUD para cualquier logueado ----
-- Usan la tabla: Clientes (mayorista.clientes.view), Guías y Facturación fábrica
-- (etiquetas de bultos) y Franquicias (lista de clientes activos).
drop policy if exists "usuarios autenticados pueden ver clientes" on public.clientes;
drop policy if exists "usuarios con permiso pueden insertar clientes" on public.clientes;
drop policy if exists "usuarios con permiso pueden actualizar clientes" on public.clientes;
drop policy if exists "usuarios con permiso pueden borrar clientes" on public.clientes;
drop policy if exists clientes_ver on public.clientes;
drop policy if exists clientes_crear on public.clientes;
drop policy if exists clientes_editar on public.clientes;
drop policy if exists clientes_borrar on public.clientes;
create policy clientes_ver on public.clientes for select to authenticated using (
  (select private.tiene_permiso('mayorista.clientes.view'))
  or (select private.tiene_permiso('mayorista.guias.view'))
  or (select private.tiene_permiso('mayorista.facturacion.view'))
  or (select private.tiene_permiso('mayorista.franquicias.view')));
-- Escritura: la pantalla decide crear/editar/borrar por app_area_acciones; en la base
-- se exige al menos el permiso de la pantalla Clientes.
create policy clientes_crear on public.clientes for insert to authenticated
  with check ((select private.tiene_permiso('mayorista.clientes.view')));
create policy clientes_editar on public.clientes for update to authenticated
  using ((select private.tiene_permiso('mayorista.clientes.view')))
  with check ((select private.tiene_permiso('mayorista.clientes.view')));
create policy clientes_borrar on public.clientes for delete to authenticated
  using ((select private.tiene_permiso('mayorista.clientes.view')));

-- ---- #2 guias / guias_opciones / facturacion_fabrica / historial (CRÍTICO) ----
-- Guías la usa el rol mayorista; Facturación fábrica también polo52 (inserta y
-- actualiza desde las dos pantallas). La campana lee guías y facturación.
create or replace function private.mayorista_fabrica()
returns boolean language sql stable security definer set search_path = public as $$
  select private.tiene_permiso('mayorista.guias.view')
      or private.tiene_permiso('mayorista.facturacion.view')
$$;
revoke all on function private.mayorista_fabrica() from public, anon;
grant execute on function private.mayorista_fabrica() to authenticated;

drop policy if exists guias_permissive on public.guias;
drop policy if exists guias_mayorista on public.guias;
create policy guias_mayorista on public.guias for all to authenticated
  using ((select private.mayorista_fabrica())) with check ((select private.mayorista_fabrica()));

drop policy if exists guias_opciones_permissive on public.guias_opciones;
drop policy if exists guias_opciones_mayorista on public.guias_opciones;
create policy guias_opciones_mayorista on public.guias_opciones for all to authenticated
  using ((select private.mayorista_fabrica())) with check ((select private.mayorista_fabrica()));

drop policy if exists facturacion_fabrica_permissive on public.facturacion_fabrica;
drop policy if exists facturacion_fabrica_mayorista on public.facturacion_fabrica;
create policy facturacion_fabrica_mayorista on public.facturacion_fabrica for all to authenticated
  using ((select private.mayorista_fabrica())) with check ((select private.mayorista_fabrica()));

-- historial: 9.254 filas de guías/facturación/NC con nombre y mail de quien hizo cada cambio.
drop policy if exists "historial ver" on public.historial;
drop policy if exists "historial registrar" on public.historial;
create policy "historial ver" on public.historial for select to authenticated
  using ((select private.mayorista_fabrica()) or (select private.tiene_permiso('mayorista.notas_credito.view')));
create policy "historial registrar" on public.historial for insert to authenticated
  with check ((select private.mayorista_fabrica()) or (select private.tiene_permiso('mayorista.notas_credito.view')));

-- ---- #3 proveedores_pacho / proveedores_pacho_guia (ALTO): CUIT, teléfono y mail de 146 proveedores ----
-- Pantallas /deposito/rma/proveedores y /deposito/rma/guia (deposito.view).
drop policy if exists pacho_auth_all on public.proveedores_pacho;
drop policy if exists pacho_deposito on public.proveedores_pacho;
create policy pacho_deposito on public.proveedores_pacho for all to authenticated
  using ((select private.tiene_permiso('deposito.view'))) with check ((select private.tiene_permiso('deposito.view')));
drop policy if exists pacho_guia_auth_all on public.proveedores_pacho_guia;
drop policy if exists pacho_guia_deposito on public.proveedores_pacho_guia;
create policy pacho_guia_deposito on public.proveedores_pacho_guia for all to authenticated
  using ((select private.tiene_permiso('deposito.view'))) with check ((select private.tiene_permiso('deposito.view')));

-- ---- #4 deposito_items / deposito_lotes / deposito_responsables (ALTO, hoy vacías) ----
-- Pantalla /deposito (deposito.view). CRUD abierto a cualquier logueado.
drop policy if exists authenticated_all on public.deposito_items;
drop policy if exists authenticated_all on public.deposito_lotes;
drop policy if exists authenticated_all on public.deposito_responsables;
drop policy if exists deposito_items_perm on public.deposito_items;
drop policy if exists deposito_lotes_perm on public.deposito_lotes;
drop policy if exists deposito_responsables_perm on public.deposito_responsables;
create policy deposito_items_perm on public.deposito_items for all to authenticated
  using ((select private.tiene_permiso('deposito.view'))) with check ((select private.tiene_permiso('deposito.view')));
create policy deposito_lotes_perm on public.deposito_lotes for all to authenticated
  using ((select private.tiene_permiso('deposito.view'))) with check ((select private.tiene_permiso('deposito.view')));
create policy deposito_responsables_perm on public.deposito_responsables for all to authenticated
  using ((select private.tiene_permiso('deposito.view'))) with check ((select private.tiene_permiso('deposito.view')));

-- ---- #5 tengo_permiso / mis_permisos no miran si el usuario está aprobado (MEDIO) ----
-- Las usan muchas reglas (cancelaciones, picking, OC, franquicias, informes, telegram...).
-- Un usuario rechazado o dado de baja que conserva roles seguiría entrando, y un
-- 'revoke' individual no le saca un permiso que da el rol. Hoy no hay casos (52
-- aprobados, ningún revoke en conflicto), por eso alinearlas no cambia nada visible.
create or replace function private.tengo_permiso(p_clave text)
returns boolean language sql stable security definer set search_path = public as $$
  select private.tiene_permiso(p_clave)
$$;
create or replace function public.mis_permisos()
returns table(clave text) language sql stable security definer set search_path = public as $$
  select x.clave from (
    select rp.permiso_clave as clave
      from public.usuario_roles ur join public.rol_permisos rp on rp.rol = ur.rol_codigo
     where ur.usuario_id = auth.uid()
    union
    select up.permiso_clave from public.usuario_permisos up
     where up.usuario_id = auth.uid() and up.efecto = 'grant'
  ) x
  where (private.es_admin() or private.usuario_aprobado())
    and not exists (select 1 from public.usuario_permisos r
                     where r.usuario_id = auth.uid() and r.permiso_clave = x.clave and r.efecto = 'revoke')
$$;
revoke execute on function public.mis_permisos() from public, anon;
grant execute on function public.mis_permisos() to authenticated;

-- ---- #6 oc_reparto(): la llama cualquiera, sin sesión (MEDIO) ----
-- Devuelve quién autoriza las OC por tipo y por responsable de gastos (nombres).
create or replace function public.oc_reparto()
returns jsonb language sql stable security definer set search_path = public as $function$
  with base as (
    select tipo, upper(coalesce(responsable, '')) resp, private.oc_clave_nombre(pasos -> 'autor' ->> 'por') quien
      from public.ordenes_compra
     where private.tengo_permiso('ordenes_compra.view')
       and pasos ? 'autor' and coalesce(pasos -> 'autor' ->> 'por', '') <> ''
       and coalesce(fecha_compra, creada_at::date) >= current_date - 90
  ),
  por_tipo as (
    select tipo, quien, count(*) n, sum(count(*)) over (partition by tipo) de,
           row_number() over (partition by tipo order by count(*) desc) r
      from base group by tipo, quien
  ),
  por_resp as (
    select resp, quien, count(*) n, sum(count(*)) over (partition by resp) de,
           row_number() over (partition by resp order by count(*) desc) r
      from base where tipo = 'Gastos' and resp <> '' group by resp, quien
  )
  select jsonb_build_object(
    'tipo', coalesce((select jsonb_object_agg(tipo, jsonb_build_object('quien', quien, 'n', n, 'de', de)) from por_tipo where r = 1), '{}'),
    'gastos_responsable', coalesce((select jsonb_object_agg(resp, jsonb_build_object('quien', quien, 'n', n, 'de', de)) from por_resp where r = 1 and de >= 3), '{}')
  )
$function$;
revoke execute on function public.oc_reparto() from public, anon;
grant execute on function public.oc_reparto() to authenticated;

-- ---- #7 Funciones sin uso o que no necesitan anon (BAJO) ----
-- admin_update_bulto: resto de la app de transporte; llama a public.is_admin() que no
-- existe en el hub y la tabla bultos tampoco. Se borra.
drop function if exists public.admin_update_bulto(uuid, text, text, text, text, boolean, text);
-- Funciones de trigger: el trigger las sigue ejecutando sin este permiso.
revoke execute on function public.sync_permissions_from_action() from public, anon, authenticated;
revoke execute on function public.sync_permissions_from_submodule() from public, anon, authenticated;
revoke execute on function public.sync_permissions_from_submodule_area() from public, anon, authenticated;
-- Helpers que solo usa la app con sesión.
revoke execute on function public.mis_origenes_transfer() from public, anon;
revoke execute on function public.nombre_local(text) from public, anon;
revoke execute on function public.repo_auto_feriados() from public, anon;
grant execute on function public.mis_origenes_transfer() to authenticated;
grant execute on function public.nombre_local(text) to authenticated;
grant execute on function public.repo_auto_feriados() to authenticated;

-- ---- #8 Lecturas "using (true)" de catálogos para cualquier logueado (BAJO) ----
-- No son datos personales salvo transportes (teléfono/mail de empresas) y qr_tokens
-- (permiten cargar opiniones a nombre de un sector). Se pide usuario aprobado.
drop policy if exists transportes_select_auth on public.transportes;
create policy transportes_select_auth on public.transportes for select to authenticated
  using ((select private.usuario_aprobado()) or (select private.es_admin()));
drop policy if exists qr_tokens_select_all on public.qr_tokens;
create policy qr_tokens_select_all on public.qr_tokens for select to authenticated
  using ((select private.tiene_permiso('opiniones.view')) or (select private.tiene_permiso('sectores.gestionar')));
drop policy if exists sectores_select_all on public.sectores;
create policy sectores_select_all on public.sectores for select to authenticated
  using ((select private.usuario_aprobado()) or (select private.es_admin()));
drop policy if exists cfg_leer on public.config_app;
create policy cfg_leer on public.config_app for select to authenticated
  using ((select private.usuario_aprobado()) or (select private.es_admin()));

commit;

-- =====================================================
-- Prueba después de aplicar (no deja rastros: termina en excepción y se deshace).
-- Un usuario recién registrado (uuid al azar, sin fila aprobada) tiene que ver 0 en todo.
-- =====================================================
-- do $$
-- declare r text;
-- begin
--   perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
--   perform set_config('role', 'authenticated', true);
--   select format('clientes=%s guias=%s facturacion=%s pacho=%s historial=%s qr=%s transportes=%s',
--     (select count(*) from public.clientes), (select count(*) from public.guias),
--     (select count(*) from public.facturacion_fabrica), (select count(*) from public.proveedores_pacho),
--     (select count(*) from public.historial), (select count(*) from public.qr_tokens),
--     (select count(*) from public.transportes)) into r;
--   raise exception 'SIMULACION (se deshace): %', r;
-- end $$;
