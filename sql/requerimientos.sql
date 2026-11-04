-- =====================================================
-- ARQUITECTURA → REQUERIMIENTOS (04/11/2026)
--
-- Reemplaza el Google Form «CARGA DE REQUERIMIENTO». Circuito:
--   1. El local carga el pedido (rubro, prioridad, quién lo pide de la nómina
--      activa, descripción y fotos). El local sale SIEMPRE de la cuenta.
--                                                       → requerimiento_crear
--   2. Arquitectura le asigna día, horario y una o más personas de mantenimiento.
--                                                       → requerimiento_programar
--   3. Mantenimiento lo ve como tarea (Mis tareas), lo empieza y lo termina
--      con comentario y foto.            → requerimiento_iniciar / _terminar
--   4. El local que lo pidió da la conformidad: quedó listo (→ resuelto) o no
--      quedó bien (vuelve a Arquitectura con el motivo).
--                                  → requerimiento_confirmar / _no_quedo
--
-- Estados: pendiente → programado → en_curso → a_confirmar → resuelto
--          (o no_corresponde, que solo pone Arquitectura).
-- Permisos:
--   requerimientos.cargar     rol locales     (solo ve, carga y confirma lo de su local)
--   requerimientos.gestionar  rol arquitecto  (bandeja, programar, descartar)
--   requerimientos.tareas     rol mantenimiento (Mis tareas: empezar / terminar)
-- Fotos: bucket privado `requerimientos` (se muestran con createSignedUrl).
-- Avisos: al programar, la bandeja llama a /api/push?tipo=requerimiento y le llega al
-- celular del local (los locales pueden anotarlo: push_suscribir en avisos_deposito_indo.sql).
-- Los pedidos importados de la planilla vieja tienen origen = 'planilla' y
-- sus fotos son links de Drive.
-- Idempotente.
-- =====================================================

-- ---------- Permisos y rol ----------
insert into public.permisos (clave, modulo, accion, label, orden) values
  ('requerimientos.cargar', 'requerimientos', 'create', 'Cargar requerimientos del local y confirmar los arreglos', 900),
  ('requerimientos.gestionar', 'requerimientos', 'edit', 'Bandeja de requerimientos: programar y descartar', 901),
  ('requerimientos.tareas', 'requerimientos', 'mark', 'Tareas de mantenimiento: empezar y terminar', 902)
on conflict (clave) do update set label = excluded.label;

insert into public.roles (codigo, nombre, es_admin, protegido, orden)
values ('mantenimiento', 'Mantenimiento', false, false, 100)
on conflict (codigo) do nothing;

insert into public.rol_permisos (rol, permiso_clave) values
  ('locales', 'requerimientos.cargar'),
  ('arquitecto', 'requerimientos.gestionar'),
  ('arquitecto', 'requerimientos.cargar'),
  ('mantenimiento', 'area_mantenimiento.view'),
  ('mantenimiento', 'requerimientos.tareas')
on conflict do nothing;

-- ---------- Tabla ----------
create table if not exists public.requerimientos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  origen text not null default 'hub' check (origen in ('hub', 'planilla')),
  local text,                     -- código de public.locales
  local_original text,            -- como venía escrito en la planilla vieja
  rubro text not null,            -- nombre en public.requerimientos_rubros
  prioridad text not null check (prioridad in ('alta', 'media', 'baja')),
  solicitante_legajo text,
  solicitante_nombre text,
  descripcion text not null,
  fotos text[] not null default '{}',
  cargado_por uuid default auth.uid(),
  cargado_email text,
  estado text not null default 'pendiente',
  -- Programación (Arquitectura): una o más personas
  programado_para timestamptz,
  asignados_legajos text[] not null default '{}',
  asignados_nombres text[] not null default '{}',
  programado_nota text,
  programado_por text,
  programado_at timestamptz,
  -- Ejecución (Mantenimiento)
  iniciado_at timestamptz,
  iniciado_por text,
  terminado_at timestamptz,
  terminado_por text,
  terminado_comentario text,
  terminado_fotos text[] not null default '{}',
  -- Si el local dice que no quedó bien, vuelve a Arquitectura con el motivo
  rechazo_motivo text,
  rechazos integer not null default 0,
  -- Cierre: conformidad del local (o «No corresponde» de Arquitectura)
  resuelto_at timestamptz,
  resuelto_por text,
  resuelto_comentario text,
  updated_at timestamptz not null default now()
);

-- Migración de la primera versión (un solo asignado; mantenimiento cerraba solo)
alter table public.requerimientos
  add column if not exists asignados_legajos text[] not null default '{}',
  add column if not exists asignados_nombres text[] not null default '{}',
  add column if not exists terminado_at timestamptz,
  add column if not exists terminado_por text,
  add column if not exists terminado_comentario text,
  add column if not exists terminado_fotos text[] not null default '{}',
  add column if not exists rechazo_motivo text,
  add column if not exists rechazos integer not null default 0,
  -- Aviso push al local con el día y horario (api/push.ts?tipo=requerimiento); se limpia al reprogramar
  add column if not exists push_local_at timestamptz;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'requerimientos' and column_name = 'asignado_legajo') then
    update public.requerimientos set asignados_legajos = array[asignado_legajo], asignados_nombres = array[coalesce(asignado_nombre, '')]
     where asignado_legajo is not null and asignados_legajos = '{}';
    drop index if exists public.requerimientos_asignado_idx;
    alter table public.requerimientos drop column asignado_legajo, drop column asignado_nombre;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'requerimientos' and column_name = 'resuelto_fotos') then
    update public.requerimientos set terminado_fotos = resuelto_fotos where resuelto_fotos <> '{}' and terminado_fotos = '{}';
    alter table public.requerimientos drop column resuelto_fotos;
  end if;
end $$;
alter table public.requerimientos drop constraint if exists requerimientos_estado_check;
alter table public.requerimientos add constraint requerimientos_estado_check
  check (estado in ('pendiente', 'programado', 'en_curso', 'a_confirmar', 'resuelto', 'no_corresponde'));

create index if not exists requerimientos_estado_idx on public.requerimientos (estado, created_at desc);
create index if not exists requerimientos_local_idx on public.requerimientos (local, created_at desc);
create index if not exists requerimientos_asignados_idx on public.requerimientos using gin (asignados_legajos);

alter table public.requerimientos enable row level security;
drop policy if exists requerimientos_ver on public.requerimientos;
create policy requerimientos_ver on public.requerimientos for select to authenticated
  using (
    private.tengo_permiso('requerimientos.gestionar')
    or private.tengo_permiso('requerimientos.tareas')
    or (private.tengo_permiso('requerimientos.cargar') and local = private.mi_local())
  );
-- Sin insert/update/delete directos: todo pasa por las funciones de abajo.

-- Cambios en vivo (bandeja, Mis tareas y la lista del local)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'requerimientos') then
    alter publication supabase_realtime add table public.requerimientos;
  end if;
end $$;

-- =====================================================
-- RUBROS EDITABLES (Arquitectura → Requerimientos → Rubros)
-- requerimientos.rubros (rol arquitecto): crear, editar (nombre, ícono, color) y borrar.
-- Borrar un rubro que ya tiene pedidos lo OCULTA (activo = false): sale del formulario
-- pero el historial lo conserva. Renombrar actualiza los pedidos que lo usan.
-- `icono` es el nombre de un ícono de la lista fija del front (ICONOS_RUBRO).
-- =====================================================
insert into public.permisos (clave, modulo, accion, label, orden) values
  ('requerimientos.rubros', 'requerimientos', 'edit', 'Rubros de requerimientos: crear, editar y borrar', 903)
on conflict (clave) do update set label = excluded.label;
insert into public.rol_permisos (rol, permiso_clave) values ('arquitecto', 'requerimientos.rubros')
on conflict do nothing;

create table if not exists public.requerimientos_rubros (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  icono text not null default 'Wrench',
  color text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  orden integer not null default 100,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.requerimientos_rubros (nombre, icono, color, orden) values
  ('ELECTRICIDAD', 'Zap', '#eab308', 10), ('DURLOCK', 'BrickWall', '#a8a29e', 20), ('PLOMERÍA', 'Droplets', '#0ea5e9', 30),
  ('GAS', 'Flame', '#f97316', 40), ('PINTURA', 'PaintRoller', '#d946ef', 50), ('CERRAJERÍA', 'KeyRound', '#f59e0b', 60),
  ('PERSIANA - PORTONES', 'Blinds', '#64748b', 70), ('HERRERÍA', 'Hammer', '#ef4444', 80), ('CARPINTERÍA', 'Axe', '#b45309', 90),
  ('VIDRIERA', 'Store', '#14b8a6', 100), ('GENERAL', 'Wrench', '#6366f1', 110)
on conflict (nombre) do nothing;

-- El rubro del pedido ya no es una lista fija: lo valida requerimiento_crear contra la tabla
alter table public.requerimientos drop constraint if exists requerimientos_rubro_check;

alter table public.requerimientos_rubros enable row level security;
drop policy if exists requerimientos_rubros_ver on public.requerimientos_rubros;
create policy requerimientos_rubros_ver on public.requerimientos_rubros for select to authenticated
  using (private.tengo_permiso('requerimientos.cargar') or private.tengo_permiso('requerimientos.gestionar')
         or private.tengo_permiso('requerimientos.tareas') or private.tengo_permiso('requerimientos.rubros'));

create or replace function public.requerimiento_rubro_guardar(
  p_id bigint, p_nombre text, p_icono text, p_color text, p_activo boolean default true
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := upper(trim(coalesce(p_nombre, '')));
  v_viejo text;
  v_id bigint;
begin
  if not private.tengo_permiso('requerimientos.rubros') then
    raise exception 'Sin permiso para editar rubros' using errcode = '42501';
  end if;
  if length(v_nombre) < 2 then raise exception 'Escribí el nombre del rubro'; end if;
  if exists (select 1 from public.requerimientos_rubros where nombre = v_nombre and id is distinct from p_id) then
    raise exception 'Ya existe el rubro %', v_nombre;
  end if;
  if p_id is null then
    insert into public.requerimientos_rubros (nombre, icono, color, orden, activo)
    values (v_nombre, coalesce(nullif(p_icono, ''), 'Wrench'), coalesce(nullif(p_color, ''), '#6366f1'),
            coalesce((select max(orden) from public.requerimientos_rubros), 0) + 10, coalesce(p_activo, true))
    returning id into v_id;
  else
    select nombre into v_viejo from public.requerimientos_rubros where id = p_id;
    if v_viejo is null then raise exception 'Ese rubro no existe'; end if;
    update public.requerimientos_rubros
       set nombre = v_nombre, icono = coalesce(nullif(p_icono, ''), icono), color = coalesce(nullif(p_color, ''), color),
           activo = coalesce(p_activo, activo)
     where id = p_id returning id into v_id;
    if v_viejo <> v_nombre then
      update public.requerimientos set rubro = v_nombre, updated_at = now() where rubro = v_viejo;
    end if;
  end if;
  return v_id;
end $$;

-- 'borrado' si nadie lo usaba; 'ocultado' si ya tiene pedidos (queda inactivo)
create or replace function public.requerimiento_rubro_borrar(p_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  if not private.tengo_permiso('requerimientos.rubros') then
    raise exception 'Sin permiso para editar rubros' using errcode = '42501';
  end if;
  select nombre into v_nombre from public.requerimientos_rubros where id = p_id;
  if v_nombre is null then raise exception 'Ese rubro no existe'; end if;
  if exists (select 1 from public.requerimientos where rubro = v_nombre) then
    update public.requerimientos_rubros set activo = false where id = p_id;
    return 'ocultado';
  end if;
  delete from public.requerimientos_rubros where id = p_id;
  return 'borrado';
end $$;

revoke all on function public.requerimiento_rubro_guardar(bigint, text, text, text, boolean) from public, anon;
revoke all on function public.requerimiento_rubro_borrar(bigint) from public, anon;
grant execute on function public.requerimiento_rubro_guardar(bigint, text, text, text, boolean) to authenticated;
grant execute on function public.requerimiento_rubro_borrar(bigint) to authenticated;

-- ---------- Helpers ----------
-- Nombre de quien opera: el legajo de la cuenta o el nombre del usuario.
create or replace function private.req_quien()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.nombre from public.usuarios u join public.empleados e on e.legajo = u.legajo where u.id = auth.uid() and u.legajo is not null limit 1),
    (select coalesce(nullif(u.nombre, ''), u.email) from public.usuarios u where u.id = auth.uid()),
    'Usuario')
$$;

-- ---------- Personas de la nómina activa ----------
-- p_sector null = toda la nómina activa (quién lo solicita);
-- 'MANTENIMIENTO' = a quién se le asigna la tarea. En los locales, `lugar` dice LOCALES
-- y el local va en `area_sector` (VCP, NVO. CENTRO, CF RUTA 9…).
create or replace function public.requerimientos_personas(p_sector text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (private.tengo_permiso('requerimientos.cargar') or private.tengo_permiso('requerimientos.gestionar')
          or private.tengo_permiso('requerimientos.tareas')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('legajo', e.legajo, 'nombre', e.nombre, 'lugar', e.lugar, 'sector', e.area_sector) order by e.nombre)
      from public.empleados e
     where e.estado_legajo = 'NOMINA ACTIVA' and e.legajo is not null
       and (p_sector is null or upper(coalesce(e.area_sector, '')) = upper(p_sector))
  ), '[]'::jsonb);
end $$;

-- ---------- Crear (local) ----------
-- El local es siempre el de la cuenta (usuarios.local), también para Arquitectura.
drop function if exists public.requerimiento_crear(text, text, text, text, text, text[], boolean);
create or replace function public.requerimiento_crear(
  p_rubro text, p_prioridad text, p_solicitante_legajo text,
  p_descripcion text, p_fotos text[] default '{}', p_ya_resuelto boolean default false
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_local text := private.mi_local();
  v_nombre text;
  v_id bigint;
begin
  if not private.tengo_permiso('requerimientos.cargar') then
    raise exception 'Sin permiso para cargar requerimientos' using errcode = '42501';
  end if;
  if v_local is null then raise exception 'Tu usuario no tiene un local asignado'; end if;

  select e.nombre into v_nombre from public.empleados e
   where e.legajo = p_solicitante_legajo and e.estado_legajo = 'NOMINA ACTIVA';
  if v_nombre is null then raise exception 'Elegí quién lo solicita'; end if;
  if length(trim(coalesce(p_descripcion, ''))) < 3 then raise exception 'Contá qué pasa'; end if;
  if not exists (select 1 from public.requerimientos_rubros where nombre = upper(p_rubro) and activo) then
    raise exception 'Elegí un rubro de la lista';
  end if;

  insert into public.requerimientos (local, rubro, prioridad, solicitante_legajo, solicitante_nombre, descripcion, fotos, cargado_email,
                                     estado, resuelto_at, resuelto_por, resuelto_comentario)
  values (v_local, upper(p_rubro), lower(p_prioridad), p_solicitante_legajo, v_nombre, trim(p_descripcion), coalesce(p_fotos, '{}'),
          (select email from public.usuarios where id = auth.uid()),
          case when p_ya_resuelto then 'resuelto' else 'pendiente' end,
          case when p_ya_resuelto then now() end,
          case when p_ya_resuelto then v_nombre end,
          case when p_ya_resuelto then 'Constancia: ya estaba resuelto al cargarlo' end)
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Programar (Arquitectura): una o más personas ----------
drop function if exists public.requerimiento_programar(bigint, timestamptz, text, text);
create or replace function public.requerimiento_programar(
  p_id bigint, p_cuando timestamptz, p_legajos text[], p_nota text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_legajos text[];
  v_nombres text[];
begin
  if not private.tengo_permiso('requerimientos.gestionar') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_cuando is null then raise exception 'Elegí día y horario'; end if;
  select array_agg(e.legajo order by e.nombre), array_agg(e.nombre order by e.nombre) into v_legajos, v_nombres
    from public.empleados e where e.legajo = any(coalesce(p_legajos, '{}')) and e.estado_legajo = 'NOMINA ACTIVA';
  if v_legajos is null then raise exception 'Elegí quién va (una o más personas)'; end if;
  update public.requerimientos
     set estado = case when estado = 'en_curso' then 'en_curso' else 'programado' end,
         programado_para = p_cuando, asignados_legajos = v_legajos, asignados_nombres = v_nombres,
         programado_nota = nullif(trim(coalesce(p_nota, '')), ''), programado_por = private.req_quien(),
         programado_at = now(), push_local_at = null, updated_at = now()
   where id = p_id and estado in ('pendiente', 'programado', 'en_curso');
  if not found then raise exception 'Ese requerimiento ya no se puede programar'; end if;
end $$;

-- ---------- Empezar / terminar (Mantenimiento) ----------
create or replace function public.requerimiento_iniciar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (private.tengo_permiso('requerimientos.tareas') or private.tengo_permiso('requerimientos.gestionar')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update public.requerimientos
     set estado = 'en_curso', iniciado_at = now(), iniciado_por = private.req_quien(), updated_at = now()
   where id = p_id and estado = 'programado';
  if not found then raise exception 'Esa tarea no está programada'; end if;
end $$;

-- Terminar no cierra: queda «a confirmar» hasta que el local dé la conformidad.
-- Mantenimiento termina lo programado o en curso; Arquitectura (botón Terminado de la
-- bandeja) también lo que está sin programar.
drop function if exists public.requerimiento_resolver(bigint, text, text[]);
create or replace function public.requerimiento_terminar(p_id bigint, p_comentario text default null, p_fotos text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (private.tengo_permiso('requerimientos.tareas') or private.tengo_permiso('requerimientos.gestionar')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update public.requerimientos
     set estado = 'a_confirmar', terminado_at = now(), terminado_por = private.req_quien(),
         terminado_comentario = nullif(trim(coalesce(p_comentario, '')), ''), terminado_fotos = coalesce(p_fotos, '{}'),
         iniciado_at = coalesce(iniciado_at, now()), updated_at = now()
   where id = p_id and (estado in ('programado', 'en_curso')
                        or (estado = 'pendiente' and private.tengo_permiso('requerimientos.gestionar')));
  if not found then raise exception 'Ese requerimiento no se puede dar por terminado'; end if;
end $$;

-- ---------- Conformidad del local ----------
create or replace function private.req_es_de_mi_local(p_id bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select private.es_admin() or (private.tengo_permiso('requerimientos.cargar')
    and exists (select 1 from public.requerimientos r where r.id = p_id and r.local = private.mi_local()))
$$;

create or replace function public.requerimiento_confirmar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.req_es_de_mi_local(p_id) then
    raise exception 'Solo el local que lo pidió puede darlo por terminado' using errcode = '42501';
  end if;
  update public.requerimientos
     set estado = 'resuelto', resuelto_at = now(), resuelto_por = private.req_quien(), updated_at = now()
   where id = p_id and estado = 'a_confirmar';
  if not found then raise exception 'Ese arreglo no está esperando confirmación'; end if;
end $$;

create or replace function public.requerimiento_no_quedo(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.req_es_de_mi_local(p_id) then
    raise exception 'Solo el local que lo pidió puede devolverlo' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Contá qué quedó mal'; end if;
  update public.requerimientos
     set estado = 'pendiente', rechazo_motivo = trim(p_motivo), rechazos = rechazos + 1,
         programado_para = null, iniciado_at = null, iniciado_por = null, updated_at = now()
   where id = p_id and estado = 'a_confirmar';
  if not found then raise exception 'Ese arreglo no está esperando confirmación'; end if;
end $$;

-- ---------- Descartar / reabrir (Arquitectura) ----------
create or replace function public.requerimiento_descartar(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.tengo_permiso('requerimientos.gestionar') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escribí el motivo'; end if;
  update public.requerimientos
     set estado = 'no_corresponde', resuelto_at = now(), resuelto_por = private.req_quien(),
         resuelto_comentario = trim(p_motivo), updated_at = now()
   where id = p_id and estado in ('pendiente', 'programado', 'en_curso', 'a_confirmar');
  if not found then raise exception 'Ese requerimiento ya está cerrado'; end if;
end $$;

create or replace function public.requerimiento_reabrir(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.tengo_permiso('requerimientos.gestionar') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update public.requerimientos
     set estado = 'pendiente', programado_para = null, resuelto_at = null, resuelto_por = null, resuelto_comentario = null,
         iniciado_at = null, iniciado_por = null, updated_at = now()
   where id = p_id and estado in ('resuelto', 'no_corresponde');
end $$;

revoke all on function public.requerimientos_personas(text) from public, anon;
revoke all on function public.requerimiento_crear(text, text, text, text, text[], boolean) from public, anon;
revoke all on function public.requerimiento_programar(bigint, timestamptz, text[], text) from public, anon;
revoke all on function public.requerimiento_iniciar(bigint) from public, anon;
revoke all on function public.requerimiento_terminar(bigint, text, text[]) from public, anon;
revoke all on function public.requerimiento_confirmar(bigint) from public, anon;
revoke all on function public.requerimiento_no_quedo(bigint, text) from public, anon;
revoke all on function public.requerimiento_descartar(bigint, text) from public, anon;
revoke all on function public.requerimiento_reabrir(bigint) from public, anon;
grant execute on function public.requerimientos_personas(text) to authenticated;
grant execute on function public.requerimiento_crear(text, text, text, text, text[], boolean) to authenticated;
grant execute on function public.requerimiento_programar(bigint, timestamptz, text[], text) to authenticated;
grant execute on function public.requerimiento_iniciar(bigint) to authenticated;
grant execute on function public.requerimiento_terminar(bigint, text, text[]) to authenticated;
grant execute on function public.requerimiento_confirmar(bigint) to authenticated;
grant execute on function public.requerimiento_no_quedo(bigint, text) to authenticated;
grant execute on function public.requerimiento_descartar(bigint, text) to authenticated;
grant execute on function public.requerimiento_reabrir(bigint) to authenticated;

-- ---------- Fotos (bucket privado) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('requerimientos', 'requerimientos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists requerimientos_fotos_leer on storage.objects;
drop policy if exists requerimientos_fotos_subir on storage.objects;
create policy requerimientos_fotos_leer on storage.objects for select to authenticated
  using (bucket_id = 'requerimientos' and (private.tengo_permiso('requerimientos.cargar')
         or private.tengo_permiso('requerimientos.gestionar') or private.tengo_permiso('requerimientos.tareas')));
create policy requerimientos_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'requerimientos' and (private.tengo_permiso('requerimientos.cargar')
         or private.tengo_permiso('requerimientos.gestionar') or private.tengo_permiso('requerimientos.tareas')));
