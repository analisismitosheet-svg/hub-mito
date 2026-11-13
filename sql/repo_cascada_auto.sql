-- ============================================================================
-- Repo diaria + Cascada entre locales: parámetros y ejecución programada (13/11/2026)
--
-- Compras > Repo diaria:
--   - Parámetros de la cascada (cascada_params): se editan en la pestaña Cascada; los
--     usa el hub al calcular y el Puente cuando corre solo.
--   - Programación: días (isodow 1=lunes … 7=domingo) y hora (Argentina) para
--       · repo  → carga los pedidos VTD en Dragon (uno por local) y, si está prendido,
--                 pide el armado de esos pedidos (como el botón «Pedir armado»).
--       · cascada → carga la cascada como un lote de Transferencias.
--   - «Correr ahora» (repo_ahora_at / cascada_ahora_at): el Puente lo toma en el minuto.
-- El Puente (puente-sql/programador.js) pregunta cada minuto con repo_auto_pendiente()
-- usando su clave (private.clave_sync_ok('puente', …)), igual que franquicias_auto_*.
-- Días que cubre una corrida: desde el día siguiente al último procesado (*_ultimo)
-- hasta ayer, con ventas (como mucho 7 días). Si nunca corrió: el último día con ventas.
-- Reintentos: si falla, vuelve a probar a los 15 minutos, hasta 3 veces en el día.
-- ============================================================================

create table if not exists public.repo_auto_config (
  id                     integer primary key default 1 check (id = 1),
  cascada_params         jsonb   not null default '{}'::jsonb,
  repo_activo            boolean not null default false,
  repo_dias              integer[] not null default '{1,2,3,4,5,6}',
  repo_hora              text    not null default '09:00',
  repo_armado            boolean not null default true,
  repo_armado_prioridad  text    not null default 'normal',
  cascada_activo         boolean not null default false,
  cascada_dias           integer[] not null default '{1,2,3,4,5,6}',
  cascada_hora           text    not null default '09:30',
  repo_ultimo            date,
  cascada_ultimo         date,
  repo_corrido_el        date,
  cascada_corrido_el     date,
  repo_ahora_at          timestamptz,
  cascada_ahora_at       timestamptz,
  repo_fallos            integer not null default 0,
  cascada_fallos         integer not null default 0,
  repo_fallo_at          timestamptz,
  cascada_fallo_at       timestamptz,
  repo_log               jsonb,
  cascada_log            jsonb,
  actualizado_por        uuid,
  actualizado_at         timestamptz not null default now(),
  constraint repo_auto_hora_ok check (repo_hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and cascada_hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint repo_auto_prioridad_ok check (repo_armado_prioridad in ('urgente', 'normal', 'baja')),
  constraint repo_auto_dias_ok check (repo_dias <@ '{1,2,3,4,5,6,7}'::integer[] and cascada_dias <@ '{1,2,3,4,5,6,7}'::integer[])
);
insert into public.repo_auto_config (id) values (1) on conflict (id) do nothing;

alter table public.repo_auto_config enable row level security;
drop policy if exists repo_auto_config_ver on public.repo_auto_config;
create policy repo_auto_config_ver on public.repo_auto_config
  for select to authenticated using ((select private.tiene_permiso('transferencias.import')));
revoke insert, update, delete on public.repo_auto_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hub: guardar parámetros / programación (solo las claves que vienen)
-- ---------------------------------------------------------------------------
create or replace function public.repo_auto_guardar(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.tiene_permiso('transferencias.import') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  if p ? 'cascada_params' and jsonb_typeof(p->'cascada_params') <> 'object' then
    raise exception 'Parámetros inválidos' using errcode = '22023';
  end if;
  update public.repo_auto_config c set
    cascada_params        = case when p ? 'cascada_params' then p->'cascada_params' else c.cascada_params end,
    repo_activo           = coalesce((p->>'repo_activo')::boolean, c.repo_activo),
    repo_dias             = case when p ? 'repo_dias' then array(select distinct x::int from jsonb_array_elements_text(p->'repo_dias') x order by 1) else c.repo_dias end,
    repo_hora             = coalesce(p->>'repo_hora', c.repo_hora),
    repo_armado           = coalesce((p->>'repo_armado')::boolean, c.repo_armado),
    repo_armado_prioridad = coalesce(p->>'repo_armado_prioridad', c.repo_armado_prioridad),
    cascada_activo        = coalesce((p->>'cascada_activo')::boolean, c.cascada_activo),
    cascada_dias          = case when p ? 'cascada_dias' then array(select distinct x::int from jsonb_array_elements_text(p->'cascada_dias') x order by 1) else c.cascada_dias end,
    cascada_hora          = coalesce(p->>'cascada_hora', c.cascada_hora),
    actualizado_por       = auth.uid(),
    actualizado_at        = now()
  where c.id = 1;
end $$;

-- «Correr ahora»: el Puente lo toma en el próximo minuto
create or replace function public.repo_auto_correr_ahora(p_tarea text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not private.tiene_permiso('transferencias.import') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_tarea = 'repo' then
    update public.repo_auto_config set repo_ahora_at = now() where id = 1;
  elsif p_tarea = 'cascada' then
    update public.repo_auto_config set cascada_ahora_at = now() where id = 1;
  else
    raise exception 'Tarea inválida' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Puente: ¿qué toca ahora?
-- ---------------------------------------------------------------------------
create or replace function public.repo_auto_pendiente(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ahora timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  hoy   date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  c     public.repo_auto_config%rowtype;
  toca_repo boolean;
  toca_cascada boolean;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  select * into c from public.repo_auto_config where id = 1;
  toca_repo := c.repo_ahora_at is not null or (
    c.repo_activo
    and extract(isodow from ahora)::int = any (c.repo_dias)
    and to_char(ahora, 'HH24:MI') >= c.repo_hora
    and coalesce(c.repo_corrido_el, date '1900-01-01') < hoy
    and (c.repo_fallos = 0 or c.repo_fallo_at < now() - interval '15 minutes'));
  toca_cascada := c.cascada_ahora_at is not null or (
    c.cascada_activo
    and extract(isodow from ahora)::int = any (c.cascada_dias)
    and to_char(ahora, 'HH24:MI') >= c.cascada_hora
    and coalesce(c.cascada_corrido_el, date '1900-01-01') < hoy
    and (c.cascada_fallos = 0 or c.cascada_fallo_at < now() - interval '15 minutes'));
  return jsonb_build_object(
    'hoy', hoy,
    'params', c.cascada_params,
    'repo', jsonb_build_object('toca', toca_repo, 'forzado', c.repo_ahora_at is not null, 'ultimo', c.repo_ultimo,
                               'armado', c.repo_armado, 'prioridad', c.repo_armado_prioridad),
    'cascada', jsonb_build_object('toca', toca_cascada, 'forzado', c.cascada_ahora_at is not null, 'ultimo', c.cascada_ultimo));
end $$;

-- Puente: resultado de una corrida. p_hasta = último día de venta que cubrió (si salió bien).
create or replace function public.repo_auto_registrar(p_token text, p_tarea text, p_ok boolean, p_texto text, p_hasta date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_log jsonb := jsonb_build_object('at', now(), 'ok', p_ok, 'texto', left(coalesce(p_texto, ''), 2000));
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_tarea = 'repo' then
    update public.repo_auto_config set
      repo_log = v_log, repo_ahora_at = null,
      repo_ultimo = case when p_ok and p_hasta is not null then greatest(coalesce(repo_ultimo, p_hasta), p_hasta) else repo_ultimo end,
      repo_corrido_el = case when p_ok or repo_fallos >= 2 then hoy else repo_corrido_el end,
      repo_fallos = case when p_ok or repo_fallos >= 2 then 0 else repo_fallos + 1 end,
      repo_fallo_at = case when p_ok then null else now() end
    where id = 1;
  elsif p_tarea = 'cascada' then
    update public.repo_auto_config set
      cascada_log = v_log, cascada_ahora_at = null,
      cascada_ultimo = case when p_ok and p_hasta is not null then greatest(coalesce(cascada_ultimo, p_hasta), p_hasta) else cascada_ultimo end,
      cascada_corrido_el = case when p_ok or cascada_fallos >= 2 then hoy else cascada_corrido_el end,
      cascada_fallos = case when p_ok or cascada_fallos >= 2 then 0 else cascada_fallos + 1 end,
      cascada_fallo_at = case when p_ok then null else now() end
    where id = 1;
  else
    raise exception 'Tarea inválida' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cascada → Transferencias: un lote con un renglón por donante/receptor/SKU.
-- p_items: [{origen, destino, articulo, descripcion, material, color, talle, cantidad}]
-- Si ya hay un lote con ese nombre en los últimos 7 días, no lo repite.
-- ---------------------------------------------------------------------------
create or replace function private.cascada_crear_lote(p_nombre text, p_motivo text, p_items jsonb, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n integer;
  v_u integer;
begin
  if coalesce(btrim(p_nombre), '') = '' then raise exception 'Falta el nombre del lote' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La cascada no tiene renglones' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 5000 then raise exception 'Demasiados renglones' using errcode = '22023'; end if;

  select id into v_id from public.transfer_lotes
   where nombre = btrim(p_nombre) and created_at > now() - interval '7 days'
   order by created_at desc limit 1;
  if v_id is not null then
    select count(*), coalesce(sum(cantidad), 0) into v_n, v_u from public.transfer_items where lote_id = v_id;
    return jsonb_build_object('id', v_id, 'repetido', true, 'renglones', v_n, 'unidades', v_u);
  end if;

  insert into public.transfer_lotes (nombre, motivo, subido_por)
  values (btrim(p_nombre), nullif(btrim(coalesce(p_motivo, '')), ''), p_uid)
  returning id into v_id;

  insert into public.transfer_items (lote_id, orden, origen, destino, articulo, descripcion, material, color, talle, tipo, cantidad)
  select v_id, (x.n - 1)::int,
         upper(btrim(x.f->>'origen')), upper(btrim(x.f->>'destino')),
         nullif(btrim(x.f->>'articulo'), ''), nullif(btrim(x.f->>'descripcion'), ''),
         nullif(btrim(x.f->>'material'), ''), nullif(btrim(x.f->>'color'), ''), nullif(btrim(x.f->>'talle'), ''),
         'VENTA', (x.f->>'cantidad')::int
    from jsonb_array_elements(p_items) with ordinality as x(f, n)
   where coalesce(btrim(x.f->>'origen'), '') <> '' and coalesce(btrim(x.f->>'destino'), '') <> ''
     and coalesce((x.f->>'cantidad')::int, 0) > 0;

  select count(*), coalesce(sum(cantidad), 0) into v_n, v_u from public.transfer_items where lote_id = v_id;
  return jsonb_build_object('id', v_id, 'repetido', false, 'renglones', v_n, 'unidades', v_u);
end $$;
revoke all on function private.cascada_crear_lote(text, text, jsonb, uuid) from public, anon, authenticated;

-- Hub: botón «Cargar en Transferencias»
create or replace function public.cascada_cargar_transferencias(p_nombre text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not private.tiene_permiso('transferencias.import') then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return private.cascada_crear_lote(p_nombre, 'Cascada entre locales (hub)', p_items, auth.uid());
end $$;

-- Puente: la cascada programada
create or replace function public.cascada_cargar_transferencias_puente(p_token text, p_nombre text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return private.cascada_crear_lote(p_nombre, 'Cascada entre locales (automática)', p_items, null);
end $$;

-- ---------------------------------------------------------------------------
-- Puente: «Pedir armado» de los pedidos VTD de la repo que acaba de cargar en Dragon.
-- Mismo alta que pedir_armado (armado + renglones), con creado_por vacío (= automático).
-- Saltea anulados, sin renglones y los que ya tienen un armado activo.
-- Devuelve { encontrados, pedidos: [numero…], pedidos_armado }.
-- ---------------------------------------------------------------------------
create or replace function public.repo_auto_pedir_armado(p_token text, p_obs text, p_prioridad text default 'normal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped public.pedidos_venta%rowtype;
  v_id uuid;
  v_n integer := 0;
  v_enc integer := 0;
  v_nums integer[] := '{}';
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_prioridad is null or p_prioridad not in ('urgente', 'normal', 'baja') then
    raise exception 'Prioridad inválida' using errcode = '22023';
  end if;
  if coalesce(btrim(p_obs), '') = '' then raise exception 'Falta la observación' using errcode = '22023'; end if;

  for v_ped in
    select * from public.pedidos_venta
     where btrim(observacion) = btrim(p_obs) and motivo = 'VTD' and not coalesce(anulado, false)
       and fecha >= current_date - 7
     order by numero
  loop
    v_enc := v_enc + 1;
    if not exists (select 1 from public.pedidos_venta_items i where i.codigo = v_ped.codigo and coalesce(round(i.cantidad), 0) > 0) then
      continue;
    end if;
    if exists (select 1 from public.mayorista_armados a where a.pedido_codigo = v_ped.codigo and a.estado in ('pendiente', 'aceptado')) then
      continue;
    end if;
    insert into public.mayorista_armados (pedido_codigo, pedido_numero, cliente, cliente_nombre, prioridad, obs, creado_por)
    values (v_ped.codigo, v_ped.numero, v_ped.cliente, v_ped.cliente_nombre, p_prioridad, 'Automático · repo diaria', null)
    returning id into v_id;
    insert into public.mayorista_armados_items (armado_id, linea, articulo, descripcion, color, talle, cantidad)
    select v_id, i.linea,
           nullif(upper(regexp_replace(coalesce(i.articulo, ''), '\s', '', 'g')), ''),
           i.descripcion, i.color, i.talle, greatest(round(i.cantidad)::integer, 0)
      from public.pedidos_venta_items i
     where i.codigo = v_ped.codigo and coalesce(round(i.cantidad), 0) > 0
     order by i.linea;
    v_n := v_n + 1;
    v_nums := v_nums || v_ped.numero;
  end loop;
  return jsonb_build_object('encontrados', v_enc, 'pedidos_armado', v_n, 'pedidos', to_jsonb(v_nums));
end $$;

revoke all on function public.repo_auto_pendiente(text) from public;
revoke all on function public.repo_auto_registrar(text, text, boolean, text, date) from public;
revoke all on function public.cascada_cargar_transferencias_puente(text, text, jsonb) from public;
revoke all on function public.repo_auto_pedir_armado(text, text, text) from public;
grant execute on function public.repo_auto_pendiente(text) to anon, authenticated;
grant execute on function public.repo_auto_registrar(text, text, boolean, text, date) to anon, authenticated;
grant execute on function public.cascada_cargar_transferencias_puente(text, text, jsonb) to anon, authenticated;
grant execute on function public.repo_auto_pedir_armado(text, text, text) to anon, authenticated;

revoke all on function public.repo_auto_guardar(jsonb) from public, anon;
revoke all on function public.repo_auto_correr_ahora(text) from public, anon;
revoke all on function public.cascada_cargar_transferencias(text, jsonb) from public, anon;
grant execute on function public.repo_auto_guardar(jsonb) to authenticated;
grant execute on function public.repo_auto_correr_ahora(text) to authenticated;
grant execute on function public.cascada_cargar_transferencias(text, jsonb) to authenticated;
