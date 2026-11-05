-- =====================================================================
-- Reposición por escaneo (Depósito · /deposito/reposicion-escaneo)
--
-- Se carga el Excel de reposición (cada hoja, una reposición; columnas de
-- artículo + una columna por local). Al escanear una prenda la pantalla dice
-- en qué caja (local) va, en grande y en voz alta, y la descuenta.
-- Varias personas pueden escanear la misma reposición a la vez: cada lectura
-- se suma en la base con bloqueo de filas.
--
-- Escrituras solo por funciones SECURITY DEFINER. Permisos:
--   repo_escaneo.view     ver la pantalla y escanear
--   repo_escaneo.cargar   cargar el Excel y cerrar reposiciones
--
-- Idempotente:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/repo_escaneo.sql
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.repo_escaneo (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,                       -- nombre del archivo
  hojas             jsonb not null default '[]'::jsonb,  -- [{hoja, locales: [...]}] en el orden del Excel
  raros             jsonb not null default '[]'::jsonb,  -- celdas que quedaron afuera
  creada_por        uuid,
  creada_por_nombre text,
  creada_at         timestamptz not null default now(),
  cerrada_at        timestamptz,
  cerrada_por       text
);
-- Volver a cargar el mismo archivo sigue la reposición abierta, no la duplica.
create unique index if not exists repo_escaneo_abierta_uq on public.repo_escaneo (nombre) where cerrada_at is null;

create table if not exists public.repo_escaneo_items (
  id            bigint generated always as identity primary key,
  reposicion_id uuid not null references public.repo_escaneo (id) on delete cascade,
  hoja          text not null,
  articulo      text not null,
  color         text not null default '',
  talle         text not null default '',
  descripcion   text,
  local         text not null,
  pedido        integer not null check (pedido > 0),
  escaneado     integer not null default 0 check (escaneado >= 0),
  unique (reposicion_id, hoja, articulo, color, talle, local)
);

create table if not exists public.repo_escaneo_lecturas (
  id            bigint generated always as identity primary key,
  reposicion_id uuid not null references public.repo_escaneo (id) on delete cascade,
  item_id       bigint not null references public.repo_escaneo_items (id) on delete cascade,
  codigo        text,
  por_uid       uuid,
  por_nombre    text,
  at            timestamptz not null default now(),
  deshecha_at   timestamptz
);
create index if not exists repo_escaneo_lecturas_repo_idx on public.repo_escaneo_lecturas (reposicion_id, at desc);
create index if not exists repo_escaneo_lecturas_item_idx on public.repo_escaneo_lecturas (item_id);

alter table public.repo_escaneo enable row level security;
alter table public.repo_escaneo_items enable row level security;
alter table public.repo_escaneo_lecturas enable row level security;

-- Solo lectura directa; todo lo demás va por las funciones de abajo.
-- Las lecturas se publican en Realtime y Realtime respeta esta política.
drop policy if exists repo_escaneo_ver on public.repo_escaneo;
create policy repo_escaneo_ver on public.repo_escaneo for select to authenticated
  using ((select private.tengo_permiso('repo_escaneo.view')));
drop policy if exists repo_escaneo_items_ver on public.repo_escaneo_items;
create policy repo_escaneo_items_ver on public.repo_escaneo_items for select to authenticated
  using ((select private.tengo_permiso('repo_escaneo.view')));
drop policy if exists repo_escaneo_lecturas_ver on public.repo_escaneo_lecturas;
create policy repo_escaneo_lecturas_ver on public.repo_escaneo_lecturas for select to authenticated
  using ((select private.tengo_permiso('repo_escaneo.view')));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'repo_escaneo_lecturas') then
    alter publication supabase_realtime add table public.repo_escaneo_lecturas;
  end if;
end $$;

-- ---------- Permisos ----------
insert into public.permisos (clave, modulo, accion, label, orden) values
  ('repo_escaneo.view',   'repo_escaneo', 'view',   'Reposición por escaneo: ver y escanear', 970),
  ('repo_escaneo.cargar', 'repo_escaneo', 'import', 'Reposición por escaneo: cargar el Excel y cerrar', 971)
on conflict (clave) do update set label = excluded.label, orden = excluded.orden;

insert into public.rol_permisos (rol, permiso_clave) values
  ('deposito', 'repo_escaneo.view'), ('deposito', 'repo_escaneo.cargar')
on conflict do nothing;

-- ---------- Ayudas internas ----------
create or replace function private.repo_escaneo_exigir(p_permiso text) returns void
language plpgsql stable security definer set search_path = 'public' as $$
begin
  if auth.uid() is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if not private.tengo_permiso(p_permiso) then
    raise exception 'No tenés permiso para esto' using errcode = '42501';
  end if;
end $$;

create or replace function private.repo_escaneo_abierta(p_id uuid) returns void
language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not exists (select 1 from public.repo_escaneo r where r.id = p_id and r.cerrada_at is null) then
    raise exception 'Esta reposición ya está cerrada' using errcode = '55000';
  end if;
end $$;

create or replace function private.repo_escaneo_mi_nombre() returns text
language sql stable security definer set search_path = 'public' as $$
  select coalesce(nullif(trim(u.nombre), ''), u.email, 'usuario') from public.usuarios u where u.id = auth.uid()
$$;

/*
 * Suma una prenda. Con p_local, a esa caja; si no, a la que más le falta de ese
 * artículo/color/talle. Sin color o talle en el código (se tipeó solo el artículo),
 * vale solo si no hay dudas de qué variante es: contar otro talle desarmaría las cajas.
 */
create or replace function private.repo_escaneo_sumar(
  p_id uuid, p_hoja text, p_articulo text, p_color text, p_talle text, p_local text, p_codigo text
) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
  v_filtro bigint[];
  v_it public.repo_escaneo_items;
  v_otras text[];
  v_lectura bigint;
  v_hojas text[];
  v_pedidas integer;
begin
  -- Bloquea todas las filas de la variante: con dos personas escaneando lo mismo,
  -- la segunda espera y después ve el conteo ya actualizado.
  select array_agg(x.id) into v_filtro from (
    select i.id from public.repo_escaneo_items i
     where i.reposicion_id = p_id and i.hoja = p_hoja and i.articulo = p_articulo
       and (p_color is null or private.mismo_color(i.color, p_color))
       and (p_talle is null or i.talle = p_talle)
     order by i.id
       for update
  ) x;

  if v_filtro is null then
    select array_agg(distinct i.hoja) into v_hojas from public.repo_escaneo_items i
     where i.reposicion_id = p_id and i.hoja <> p_hoja and i.articulo = p_articulo
       and (p_color is null or private.mismo_color(i.color, p_color))
       and (p_talle is null or i.talle = p_talle);
    return jsonb_build_object('estado', 'no_esta', 'articulo', p_articulo, 'color', p_color, 'talle', p_talle,
                              'otras_hojas', coalesce(to_jsonb(v_hojas), '[]'::jsonb));
  end if;

  if (select count(distinct (i.color, i.talle)) from public.repo_escaneo_items i where i.id = any(v_filtro)) > 1 then
    return jsonb_build_object('estado', 'ambiguo', 'articulo', p_articulo, 'color', p_color, 'talle', p_talle);
  end if;

  select i.* into v_it from public.repo_escaneo_items i
   where i.id = any(v_filtro) and i.escaneado < i.pedido
     and (p_local is null or i.local = p_local)
   order by i.pedido - i.escaneado desc, i.id
   limit 1;

  if v_it.id is null then
    select i.* into v_it from public.repo_escaneo_items i where i.id = any(v_filtro) order by i.id limit 1;
    select sum(i.pedido) into v_pedidas from public.repo_escaneo_items i where i.id = any(v_filtro);
    return jsonb_build_object('estado', 'sobra', 'articulo', v_it.articulo, 'color', v_it.color, 'talle', v_it.talle,
                              'descripcion', v_it.descripcion, 'pedidas', v_pedidas);
  end if;

  update public.repo_escaneo_items set escaneado = escaneado + 1 where id = v_it.id returning * into v_it;

  insert into public.repo_escaneo_lecturas (reposicion_id, item_id, codigo, por_uid, por_nombre)
  values (p_id, v_it.id, p_codigo, auth.uid(), private.repo_escaneo_mi_nombre())
  returning id into v_lectura;

  select array_agg(distinct i.local) into v_otras from public.repo_escaneo_items i
   where i.id = any(v_filtro) and i.id <> v_it.id and i.escaneado < i.pedido;

  return jsonb_build_object(
    'estado', 'ok', 'lectura', v_lectura, 'item', v_it.id, 'articulo', v_it.articulo, 'color', v_it.color,
    'talle', v_it.talle, 'descripcion', v_it.descripcion, 'local', v_it.local, 'pedido', v_it.pedido,
    'escaneado', v_it.escaneado, 'otras', coalesce(to_jsonb(v_otras), '[]'::jsonb));
end $$;

-- ---------- Funciones de la pantalla ----------

-- Reposiciones abiertas con su avance
create or replace function public.repo_escaneo_lista() returns jsonb
language plpgsql stable security definer set search_path = 'public' as $$
begin
  perform private.repo_escaneo_exigir('repo_escaneo.view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'nombre', r.nombre, 'creada_por', r.creada_por_nombre, 'creada_at', r.creada_at,
             'pedidas', t.pedidas, 'escaneadas', t.escaneadas) order by r.creada_at desc)
      from public.repo_escaneo r
      cross join lateral (
        select coalesce(sum(i.pedido), 0) pedidas, coalesce(sum(least(i.escaneado, i.pedido)), 0) escaneadas
          from public.repo_escaneo_items i where i.reposicion_id = r.id
      ) t
     where r.cerrada_at is null), '[]'::jsonb);
end $$;

/*
 * Crea la reposición con lo leído del Excel (el mismo artículo repetido se suma).
 * Si ya hay una abierta con ese nombre de archivo, la devuelve sin tocarla.
 * p_items: [{hoja, articulo, color, talle, descripcion, local, pedido}]
 */
create or replace function public.repo_escaneo_crear(p_nombre text, p_hojas jsonb, p_items jsonb, p_raros jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
  v_id uuid;
begin
  perform private.repo_escaneo_exigir('repo_escaneo.cargar');
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Falta el nombre del archivo' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El archivo no trae artículos' using errcode = '22023';
  end if;

  insert into public.repo_escaneo (nombre, hojas, raros, creada_por, creada_por_nombre)
  values (trim(p_nombre), coalesce(p_hojas, '[]'::jsonb), coalesce(p_raros, '[]'::jsonb), auth.uid(), private.repo_escaneo_mi_nombre())
  on conflict (nombre) where cerrada_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select r.id into v_id from public.repo_escaneo r where r.nombre = trim(p_nombre) and r.cerrada_at is null;
    return jsonb_build_object('id', v_id, 'ya_existia', true);
  end if;

  insert into public.repo_escaneo_items (reposicion_id, hoja, articulo, color, talle, descripcion, local, pedido)
  select v_id, x.hoja, x.articulo, x.color, x.talle, max(x.descripcion), x.local, sum(x.pedido)
    from (
      select j.hoja,
             upper(regexp_replace(coalesce(j.articulo, ''), '\s', '', 'g')) articulo,
             upper(regexp_replace(coalesce(j.color, ''), '\s', '', 'g')) color,
             upper(regexp_replace(coalesce(j.talle, ''), '\s', '', 'g')) talle,
             j.descripcion, upper(trim(j.local)) local, j.pedido
        from jsonb_to_recordset(p_items) as j(hoja text, articulo text, color text, talle text, descripcion text, local text, pedido integer)
    ) x
   where x.articulo <> '' and x.pedido > 0
   group by x.hoja, x.articulo, x.color, x.talle, x.local;

  return jsonb_build_object('id', v_id, 'ya_existia', false);
end $$;

-- Todo lo de una reposición. Arrays compactos: puede tener miles de renglones.
-- items: [id, hoja, articulo, color, talle, descripcion, local, pedido, escaneado]
create or replace function public.repo_escaneo_detalle(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = 'public' as $$
declare
  v jsonb;
begin
  perform private.repo_escaneo_exigir('repo_escaneo.view');
  select jsonb_build_object('id', r.id, 'nombre', r.nombre, 'hojas', r.hojas, 'raros', r.raros, 'cerrada_at', r.cerrada_at,
           'items', coalesce((
             select jsonb_agg(jsonb_build_array(i.id, i.hoja, i.articulo, i.color, i.talle, i.descripcion, i.local, i.pedido, i.escaneado) order by i.id)
               from public.repo_escaneo_items i where i.reposicion_id = r.id), '[]'::jsonb))
    into v from public.repo_escaneo r where r.id = p_id;
  if v is null then
    raise exception 'No encontré esa reposición' using errcode = 'P0002';
  end if;
  return v;
end $$;

-- Lo que cambia mientras se escanea (liviano, para refrescar seguido):
-- items: [id, escaneado] solo los que tienen algo escaneado; ultimos: las últimas lecturas de la hoja.
create or replace function public.repo_escaneo_avance(p_id uuid, p_hoja text) returns jsonb
language plpgsql stable security definer set search_path = 'public' as $$
begin
  perform private.repo_escaneo_exigir('repo_escaneo.view');
  return jsonb_build_object(
    'cerrada_at', (select r.cerrada_at from public.repo_escaneo r where r.id = p_id),
    'items', coalesce((select jsonb_agg(jsonb_build_array(i.id, i.escaneado))
                         from public.repo_escaneo_items i
                        where i.reposicion_id = p_id and i.escaneado > 0), '[]'::jsonb),
    'ultimos', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'item', u.item_id, 'por', u.por_nombre, 'at', u.at) order by u.at desc, u.id desc)
                           from (select l.id, l.item_id, l.por_nombre, l.at
                                   from public.repo_escaneo_lecturas l
                                   join public.repo_escaneo_items i on i.id = l.item_id
                                  where l.reposicion_id = p_id and l.deshecha_at is null and i.hoja = p_hoja
                                  order by l.at desc, l.id desc limit 6) u), '[]'::jsonb));
end $$;

create or replace function public.repo_escaneo_escanear(p_id uuid, p_hoja text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
  v_cb record;
begin
  perform private.repo_escaneo_exigir('repo_escaneo.view');
  perform private.repo_escaneo_abierta(p_id);
  v_cb := private.parsear_codigo_barras(p_codigo);
  if coalesce(v_cb.codigo, '') = '' then
    raise exception 'Código vacío' using errcode = '22023';
  end if;
  return private.repo_escaneo_sumar(p_id, p_hoja, v_cb.codigo, v_cb.color, v_cb.talle, null, p_codigo);
end $$;

-- Deshace la última lectura de esta persona en la reposición
create or replace function public.repo_escaneo_deshacer(p_id uuid) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
  v_l public.repo_escaneo_lecturas;
  v_it public.repo_escaneo_items;
begin
  perform private.repo_escaneo_exigir('repo_escaneo.view');
  perform private.repo_escaneo_abierta(p_id);
  select l.* into v_l from public.repo_escaneo_lecturas l
   where l.reposicion_id = p_id and l.por_uid = auth.uid() and l.deshecha_at is null
   order by l.at desc, l.id desc limit 1 for update;
  if v_l.id is null then
    return jsonb_build_object('estado', 'nada');
  end if;
  update public.repo_escaneo_lecturas set deshecha_at = now() where id = v_l.id;
  update public.repo_escaneo_items set escaneado = greatest(escaneado - 1, 0) where id = v_l.item_id returning * into v_it;
  return jsonb_build_object('estado', 'ok', 'item', v_it.id, 'articulo', v_it.articulo, 'color', v_it.color,
                            'talle', v_it.talle, 'local', v_it.local, 'escaneado', v_it.escaneado);
end $$;

-- «La puse en otra caja»: corrige una lectura propia a otro local, todo o nada
create or replace function public.repo_escaneo_mover(p_lectura bigint, p_local text) returns jsonb
language plpgsql security definer set search_path = 'public' as $$
declare
  v_l public.repo_escaneo_lecturas;
  v_it public.repo_escaneo_items;
  v_res jsonb;
begin
  perform private.repo_escaneo_exigir('repo_escaneo.view');
  select l.* into v_l from public.repo_escaneo_lecturas l
   where l.id = p_lectura and l.por_uid = auth.uid() and l.deshecha_at is null for update;
  if v_l.id is null then
    raise exception 'Esa lectura ya no se puede corregir' using errcode = 'P0002';
  end if;
  perform private.repo_escaneo_abierta(v_l.reposicion_id);

  update public.repo_escaneo_lecturas set deshecha_at = now() where id = v_l.id;
  update public.repo_escaneo_items set escaneado = greatest(escaneado - 1, 0) where id = v_l.item_id returning * into v_it;

  v_res := private.repo_escaneo_sumar(v_l.reposicion_id, v_it.hoja, v_it.articulo, v_it.color, v_it.talle, upper(trim(p_local)), v_l.codigo);
  if v_res ->> 'estado' <> 'ok' or v_res ->> 'local' <> upper(trim(p_local)) then
    raise exception 'A % ya no le falta este artículo', p_local using errcode = '55000';
  end if;
  return v_res;
end $$;

create or replace function public.repo_escaneo_cerrar(p_id uuid) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  perform private.repo_escaneo_exigir('repo_escaneo.cargar');
  update public.repo_escaneo set cerrada_at = now(), cerrada_por = private.repo_escaneo_mi_nombre()
   where id = p_id and cerrada_at is null;
end $$;

-- ---------- Quién ejecuta ----------
revoke all on function public.repo_escaneo_lista() from public, anon;
revoke all on function public.repo_escaneo_crear(text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.repo_escaneo_detalle(uuid) from public, anon;
revoke all on function public.repo_escaneo_avance(uuid, text) from public, anon;
revoke all on function public.repo_escaneo_escanear(uuid, text, text) from public, anon;
revoke all on function public.repo_escaneo_deshacer(uuid) from public, anon;
revoke all on function public.repo_escaneo_mover(bigint, text) from public, anon;
revoke all on function public.repo_escaneo_cerrar(uuid) from public, anon;
grant execute on function public.repo_escaneo_lista() to authenticated;
grant execute on function public.repo_escaneo_crear(text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.repo_escaneo_detalle(uuid) to authenticated;
grant execute on function public.repo_escaneo_avance(uuid, text) to authenticated;
grant execute on function public.repo_escaneo_escanear(uuid, text, text) to authenticated;
grant execute on function public.repo_escaneo_deshacer(uuid) to authenticated;
grant execute on function public.repo_escaneo_mover(bigint, text) to authenticated;
grant execute on function public.repo_escaneo_cerrar(uuid) to authenticated;
