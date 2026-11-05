-- =====================================================================
-- Órdenes de compras (Compras · Depósito · Diseño · Arquitectura · Administración)
--
-- Reemplaza la planilla «Alta Órdenes de Compras Mito»: alta de OC y su recorrido
-- (validación de Compras → autorización financiera → enviada / aceptada por el
-- proveedor → OC, remito y factura en Flexxus). Las OC de producto se pueden crear
-- en Dragon (pedido de compra) por la API, con el mismo número.
--
-- La autorización se pide por WhatsApp con el botón «Pedir autorización» (nunca
-- sola): le llega al autorizador que corresponde según el historial (quién autorizó
-- cada tipo de OC en los últimos 90 días) y, si no contesta en N horas, a los demás.
-- Los autorizadores salen de la agenda de «Envío informes y reportes»
-- (informes_contactos).
--
-- Escrituras solo por funciones SECURITY DEFINER (validan permisos una vez).
-- Permisos:
--   ordenes_compra.view        ver la pantalla, cargar OC y ver las propias y las de su área
--   ordenes_compra.ver_todas   ver todas las OC
--   ordenes_compra.compras     validar, enviada/aceptada, cancelar, editar cualquiera, crear en Dragon
--   ordenes_compra.flexxus     OC / remito / factura cargados en Flexxus
--   ordenes_compra.autorizar   autorizar desde el hub (además del WhatsApp)
--   (el admin, todo; config de autorizadores y borrar: solo admin)
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.ordenes_compra (
  numero            integer primary key,
  tipo              text not null default 'Gastos' check (tipo in ('Producto', 'Gastos', 'Servicios', 'Talleres')),
  planificable      boolean not null default true,
  metodo            text not null default 'Sin anticipo' check (metodo in ('Sin anticipo', 'Con anticipo', 'Compra directa')),
  area              text,
  responsable       text,
  proveedor         text,
  proveedor_cuit    text,
  contacto          text,
  telefono          text,
  mail              text,
  observacion       text,
  fecha_compra      date,
  fecha_entrega     date,
  forma_pago        text,
  plazo             text,
  monto_bruto       numeric(16, 2),
  archivo_url       text,
  archivo_path      text,
  obs_propias       text,
  -- Recorrido: { valid|autor|env|acep|f_oc|f_rem|f_fac: { por, uid, at, via } }
  pasos             jsonb not null default '{}'::jsonb,
  cancelada_at      timestamptz,
  cancelada_por     text,
  cancelada_motivo  text,
  no_autorizada     boolean not null default false,
  -- Pedido de autorización (manual, botón «Pedir autorización»)
  pedida_at         timestamptz,
  pedida_por        text,
  pedida_a          text[],
  ampliada_at       timestamptz,
  -- Dragon (pedido de compra por la API)
  dragon            boolean not null default false,
  dragon_base       text default 'INDOD',
  dragon_proveedor  text,
  dragon_proveedor_nombre text,
  dragon_motivo     text,
  dragon_condicion  text,
  dragon_lista      text default 'LISTA0',
  dragon_items      jsonb not null default '[]'::jsonb,
  dragon_estado     text check (dragon_estado in ('pendiente', 'enviando', 'ok', 'error')),
  dragon_error      text,
  dragon_codigo     text,
  dragon_por        text,
  dragon_at         timestamptz,
  importada         boolean not null default false,
  creada_por        uuid,
  creada_por_nombre text,
  creada_at         timestamptz not null default now(),
  actualizada_at    timestamptz not null default now()
);
create index if not exists ordenes_compra_fecha_idx on public.ordenes_compra (fecha_compra desc);
create index if not exists ordenes_compra_dragon_idx on public.ordenes_compra (dragon_estado) where dragon_estado in ('pendiente', 'enviando');

create table if not exists public.ordenes_compra_eventos (
  id       bigint generated always as identity primary key,
  numero   integer not null references public.ordenes_compra (numero) on delete cascade,
  at       timestamptz not null default now(),
  por      text,
  uid      uuid,
  texto    text not null
);
create index if not exists ordenes_compra_eventos_num_idx on public.ordenes_compra_eventos (numero, at);

create table if not exists public.ordenes_compra_whatsapp (
  id           bigint generated always as identity primary key,
  numero       integer not null references public.ordenes_compra (numero) on delete cascade,
  contacto_id  uuid,
  nombre       text,
  telefono     text not null,
  motivo       text not null default 'pedido' check (motivo in ('pedido', 'ampliado')),
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'error')),
  detalle      text,
  wamid        text,
  respuesta    text,
  respondio_at timestamptz,
  creado_at    timestamptz not null default now()
);
create index if not exists ordenes_compra_whatsapp_num_idx on public.ordenes_compra_whatsapp (numero);

create table if not exists public.ordenes_compra_config (
  id             int primary key default 1 check (id = 1),
  autorizadores  uuid[] not null default '{}',
  reparto_auto   boolean not null default true,
  horas_espera   int not null default 4 check (horas_espera between 1 and 72),
  actualizada_at timestamptz not null default now()
);
insert into public.ordenes_compra_config (id) values (1) on conflict (id) do nothing;
-- Arranque: Diego y Esteban (los que autorizan hoy), si están en la agenda
update public.ordenes_compra_config c
   set autorizadores = coalesce((select array_agg(id) from public.informes_contactos
                                  where lower(nombre) in ('diego', 'esteban')), '{}')
 where c.id = 1 and c.autorizadores = '{}';

alter table public.ordenes_compra enable row level security;
alter table public.ordenes_compra_eventos enable row level security;
alter table public.ordenes_compra_whatsapp enable row level security;
alter table public.ordenes_compra_config enable row level security;

-- ---------- Permisos ----------
insert into public.permisos (clave, modulo, accion, label, orden) values
  ('ordenes_compra.view',      'ordenes_compra', 'view',    'Órdenes de compras: ver, cargar y ver las propias y las de su área', 960),
  ('ordenes_compra.ver_todas', 'ordenes_compra', 'view',    'Órdenes de compras: ver todas', 961),
  ('ordenes_compra.compras',   'ordenes_compra', 'edit',    'Órdenes de compras: validar, enviar/aceptar, cancelar y crear en Dragon', 962),
  ('ordenes_compra.flexxus',   'ordenes_compra', 'mark',    'Órdenes de compras: OC, remito y factura en Flexxus', 963),
  ('ordenes_compra.autorizar', 'ordenes_compra', 'approve', 'Órdenes de compras: autorizar desde el hub', 964)
on conflict (clave) do update set label = excluded.label, orden = excluded.orden;

insert into public.rol_permisos (rol, permiso_clave) values
  ('compras', 'ordenes_compra.view'), ('compras', 'ordenes_compra.ver_todas'), ('compras', 'ordenes_compra.compras'),
  ('deposito', 'ordenes_compra.view'),
  ('arquitecto', 'ordenes_compra.view'),
  ('administracion', 'ordenes_compra.view'), ('administracion', 'ordenes_compra.ver_todas'), ('administracion', 'ordenes_compra.flexxus')
on conflict do nothing;

-- ---------- Helpers ----------
-- Nombre para mostrar del usuario actual
create or replace function private.oc_mi_nombre() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(u.nombre), ''), u.email, 'usuario') from public.usuarios u where u.id = auth.uid()
$$;

-- Áreas del usuario (por los permisos de área del menú)
create or replace function private.oc_mis_areas() returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when private.tengo_permiso('area_compras.view') then 'Compras' end,
    case when private.tengo_permiso('area_deposito.view') then 'Depósito' end,
    case when private.tengo_permiso('area_diseno.view') then 'Diseño' end,
    case when private.tengo_permiso('area_arquitectura.view') then 'Arquitectura' end,
    case when private.tengo_permiso('area_administracion.view') then 'Administración' end
  ], null)
$$;

create or replace function private.oc_puedo_ver(p_area text, p_creada_por uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.tengo_permiso('ordenes_compra.ver_todas')
      or (private.tengo_permiso('ordenes_compra.view')
          and (p_creada_por = auth.uid() or p_area = any (private.oc_mis_areas())))
$$;

-- Primer nombre sin acentos ni mayúsculas: «ESTEBAN MONTAÑÉS» y «Esteban» → 'esteban'
create or replace function private.oc_clave_nombre(p text) returns text
language sql immutable as $$
  select split_part(translate(lower(trim(coalesce(p, ''))), 'áéíóúüñ', 'aeiouun'), ' ', 1)
$$;

create or replace function private.oc_evento(p_numero int, p_texto text) returns void
language sql security definer set search_path = public as $$
  insert into public.ordenes_compra_eventos (numero, por, uid, texto)
  values (p_numero, coalesce(private.oc_mi_nombre(), 'sistema'), auth.uid(), p_texto)
$$;

-- ---------- RLS (lectura) ----------
drop policy if exists ordenes_compra_leer on public.ordenes_compra;
create policy ordenes_compra_leer on public.ordenes_compra for select to authenticated
  using (private.oc_puedo_ver(area, creada_por));

drop policy if exists ordenes_compra_eventos_leer on public.ordenes_compra_eventos;
create policy ordenes_compra_eventos_leer on public.ordenes_compra_eventos for select to authenticated
  using (exists (select 1 from public.ordenes_compra o where o.numero = ordenes_compra_eventos.numero
                  and private.oc_puedo_ver(o.area, o.creada_por)));

drop policy if exists ordenes_compra_whatsapp_leer on public.ordenes_compra_whatsapp;
create policy ordenes_compra_whatsapp_leer on public.ordenes_compra_whatsapp for select to authenticated
  using (exists (select 1 from public.ordenes_compra o where o.numero = ordenes_compra_whatsapp.numero
                  and private.oc_puedo_ver(o.area, o.creada_por)));

drop policy if exists ordenes_compra_config_leer on public.ordenes_compra_config;
create policy ordenes_compra_config_leer on public.ordenes_compra_config for select to authenticated
  using (private.tengo_permiso('ordenes_compra.view'));

grant select on public.ordenes_compra, public.ordenes_compra_eventos, public.ordenes_compra_whatsapp, public.ordenes_compra_config to authenticated;

-- ---------- Reparto de la autorización (aprendido del historial) ----------
-- Quién autorizó cada tipo de OC (y, en Gastos, las de cada responsable) en los últimos 90 días.
create or replace function public.oc_reparto() returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (
    select tipo, upper(coalesce(responsable, '')) resp, private.oc_clave_nombre(pasos -> 'autor' ->> 'por') quien
      from public.ordenes_compra
     where pasos ? 'autor' and coalesce(pasos -> 'autor' ->> 'por', '') <> ''
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
$$;

-- A quién le llega el aviso de una OC: { contactos: [{id,nombre,telefono}], sugerido, motivo, resto: [...] }
create or replace function private.oc_destinatarios(p_numero int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.ordenes_compra;
  cfg public.ordenes_compra_config;
  rep jsonb := public.oc_reparto();
  regla jsonb;
  motivo text;
  todos jsonb;
  elegido jsonb;
begin
  select * into o from public.ordenes_compra where numero = p_numero;
  select * into cfg from public.ordenes_compra_config where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono) order by c.nombre), '[]')
    into todos
    from public.informes_contactos c where c.id = any (cfg.autorizadores) and c.activo;
  if cfg.reparto_auto then
    regla := case when o.tipo = 'Gastos' then rep -> 'gastos_responsable' -> upper(coalesce(o.responsable, '')) end;
    if regla is not null then
      motivo := format('de las OC de Gastos de %s, %s autorizó %s de %s', initcap(lower(o.responsable)), initcap(regla ->> 'quien'), regla ->> 'n', regla ->> 'de');
    else
      regla := rep -> 'tipo' -> o.tipo;
      if regla is not null then
        motivo := format('de las OC de %s, %s autorizó %s de %s', o.tipo, initcap(regla ->> 'quien'), regla ->> 'n', regla ->> 'de');
      end if;
    end if;
    if regla is not null then
      select coalesce(jsonb_agg(x), '[]') into elegido
        from jsonb_array_elements(todos) x
       where private.oc_clave_nombre(x ->> 'nombre') = regla ->> 'quien';
    end if;
  end if;
  if elegido is not null and jsonb_array_length(elegido) > 0 then
    return jsonb_build_object('contactos', elegido, 'motivo', motivo,
      'resto', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(todos) x where not (elegido @> jsonb_build_array(x))),
      'horas', cfg.horas_espera);
  end if;
  return jsonb_build_object('contactos', todos, 'motivo', null, 'resto', '[]'::jsonb, 'horas', cfg.horas_espera);
end $$;

-- Para la pantalla: a quién le va a llegar (solo nombres, sin teléfonos)
create or replace function public.oc_sugerido(p_numero int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb; o public.ordenes_compra;
begin
  select * into o from public.ordenes_compra where numero = p_numero;
  if o.numero is null or not private.oc_puedo_ver(o.area, o.creada_por) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  d := private.oc_destinatarios(p_numero);
  return jsonb_build_object(
    'nombres', (select coalesce(jsonb_agg(x ->> 'nombre'), '[]') from jsonb_array_elements(d -> 'contactos') x),
    'resto',   (select coalesce(jsonb_agg(x ->> 'nombre'), '[]') from jsonb_array_elements(d -> 'resto') x),
    'motivo', d -> 'motivo', 'horas', d -> 'horas');
end $$;

-- ---------- Alta / edición ----------
create or replace function public.oc_guardar(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_num int := nullif(p ->> 'numero', '')::int;
  o public.ordenes_compra;
  es_compras boolean := private.tengo_permiso('ordenes_compra.compras');
  v_items jsonb := coalesce(p -> 'dragon_items', '[]'::jsonb);
  v_dragon boolean := coalesce((p ->> 'dragon')::boolean, false);
  v_monto numeric := nullif(p ->> 'monto_bruto', '')::numeric;
begin
  if not private.tengo_permiso('ordenes_compra.view') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if coalesce(p ->> 'tipo', '') not in ('Producto', 'Gastos', 'Servicios', 'Talleres') then raise exception 'Elegí el tipo de compra'; end if;
  if coalesce(trim(p ->> 'proveedor'), '') = '' then raise exception 'Falta el proveedor'; end if;
  -- Con Dragon, el monto bruto es el total de los artículos con IVA (21 %)
  if v_dragon and jsonb_array_length(v_items) > 0 then
    select round(sum(coalesce((i ->> 'cantidad')::numeric, 0) * coalesce((i ->> 'precio')::numeric, 0)) * 1.21, 2)
      into v_monto from jsonb_array_elements(v_items) i;
  end if;

  if v_num is null then
    perform pg_advisory_xact_lock(hashtext('ordenes_compra_numero'));
    select greatest(coalesce(max(numero), 0) + 1, 15550) into v_num from public.ordenes_compra;
    insert into public.ordenes_compra (numero, creada_por, creada_por_nombre) values (v_num, auth.uid(), private.oc_mi_nombre());
    perform private.oc_evento(v_num, 'creó la OC');
  else
    select * into o from public.ordenes_compra where numero = v_num for update;
    if o.numero is null then raise exception 'No existe la OC %', v_num; end if;
    if not (es_compras or (o.creada_por = auth.uid() and not (o.pasos ? 'autor'))) then
      raise exception 'Solo Compras puede editar esta OC (o quien la cargó, antes de que se autorice)' using errcode = '42501';
    end if;
    if o.dragon_estado in ('enviando', 'ok') and v_dragon and o.dragon_items is distinct from v_items then
      raise exception 'La OC ya se mandó a Dragon: los artículos no se pueden cambiar desde acá';
    end if;
    perform private.oc_evento(v_num, 'editó la OC');
  end if;

  update public.ordenes_compra set
    tipo = p ->> 'tipo',
    planificable = coalesce((p ->> 'planificable')::boolean, true),
    metodo = coalesce(nullif(p ->> 'metodo', ''), 'Sin anticipo'),
    area = nullif(p ->> 'area', ''),
    responsable = nullif(trim(p ->> 'responsable'), ''),
    proveedor = trim(p ->> 'proveedor'),
    proveedor_cuit = nullif(trim(p ->> 'proveedor_cuit'), ''),
    contacto = nullif(trim(p ->> 'contacto'), ''),
    telefono = nullif(trim(p ->> 'telefono'), ''),
    mail = nullif(trim(p ->> 'mail'), ''),
    observacion = nullif(trim(p ->> 'observacion'), ''),
    fecha_compra = nullif(p ->> 'fecha_compra', '')::date,
    fecha_entrega = nullif(p ->> 'fecha_entrega', '')::date,
    forma_pago = nullif(p ->> 'forma_pago', ''),
    plazo = nullif(p ->> 'plazo', ''),
    monto_bruto = v_monto,
    archivo_url = nullif(trim(p ->> 'archivo_url'), ''),
    archivo_path = coalesce(nullif(p ->> 'archivo_path', ''), archivo_path),
    dragon = v_dragon,
    dragon_base = coalesce(nullif(p ->> 'dragon_base', ''), 'INDOD'),
    dragon_proveedor = nullif(p ->> 'dragon_proveedor', ''),
    dragon_proveedor_nombre = nullif(p ->> 'dragon_proveedor_nombre', ''),
    dragon_motivo = nullif(p ->> 'dragon_motivo', ''),
    dragon_condicion = nullif(p ->> 'dragon_condicion', ''),
    dragon_lista = coalesce(nullif(p ->> 'dragon_lista', ''), 'LISTA0'),
    dragon_items = case when dragon_estado in ('enviando', 'ok') then dragon_items else v_items end,
    actualizada_at = now()
  where numero = v_num;
  return v_num;
end $$;

-- Notas internas (cualquiera que la ve)
create or replace function public.oc_obs_propias(p_numero int, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.ordenes_compra;
begin
  select * into o from public.ordenes_compra where numero = p_numero;
  if o.numero is null or not private.oc_puedo_ver(o.area, o.creada_por) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  update public.ordenes_compra set obs_propias = nullif(trim(p_texto), ''), actualizada_at = now() where numero = p_numero;
end $$;

-- ---------- Tildes del recorrido ----------
create or replace function public.oc_paso(p_numero int, p_paso text, p_hecho boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes_compra;
  permiso text := case p_paso
    when 'valid' then 'ordenes_compra.compras' when 'env' then 'ordenes_compra.compras' when 'acep' then 'ordenes_compra.compras'
    when 'autor' then 'ordenes_compra.autorizar'
    when 'f_oc' then 'ordenes_compra.flexxus' when 'f_rem' then 'ordenes_compra.flexxus' when 'f_fac' then 'ordenes_compra.flexxus' end;
  nombres jsonb := '{"valid":"Validación Dto. Compras","autor":"Autorización financiera","env":"Enviada al proveedor","acep":"Aceptada por el proveedor","f_oc":"OC cargada en Flexxus","f_rem":"Remito cargado en Flexxus","f_fac":"Factura cargada en Flexxus"}';
begin
  if permiso is null then raise exception 'Paso inválido'; end if;
  if not private.tengo_permiso(permiso) then raise exception 'No tenés permiso para este paso' using errcode = '42501'; end if;
  select * into o from public.ordenes_compra where numero = p_numero for update;
  if o.numero is null then raise exception 'No existe la OC %', p_numero; end if;
  if o.cancelada_at is not null and p_hecho then raise exception 'La OC está cancelada'; end if;
  if p_hecho then
    update public.ordenes_compra
       set pasos = pasos || jsonb_build_object(p_paso, jsonb_build_object('por', private.oc_mi_nombre(), 'uid', auth.uid(), 'at', now(), 'via', 'hub')),
           actualizada_at = now()
     where numero = p_numero;
    perform private.oc_evento(p_numero, format('tildó «%s»', nombres ->> p_paso));
  else
    update public.ordenes_compra set pasos = pasos - p_paso, actualizada_at = now() where numero = p_numero;
    perform private.oc_evento(p_numero, format('destildó «%s»', nombres ->> p_paso));
  end if;
  return (select pasos from public.ordenes_compra where numero = p_numero);
end $$;

create or replace function public.oc_cancelar(p_numero int, p_motivo text, p_reabrir boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (private.tengo_permiso('ordenes_compra.compras') or private.tengo_permiso('ordenes_compra.autorizar')) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if p_reabrir then
    update public.ordenes_compra set cancelada_at = null, cancelada_por = null, cancelada_motivo = null, no_autorizada = false, actualizada_at = now()
     where numero = p_numero;
    perform private.oc_evento(p_numero, 'reabrió la OC');
  else
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Poné el motivo'; end if;
    update public.ordenes_compra set cancelada_at = now(), cancelada_por = private.oc_mi_nombre(), cancelada_motivo = trim(p_motivo), actualizada_at = now()
     where numero = p_numero;
    perform private.oc_evento(p_numero, format('la canceló: %s', trim(p_motivo)));
  end if;
end $$;

create or replace function public.oc_borrar(p_numero int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.es_admin() then raise exception 'Solo el administrador puede borrar una OC' using errcode = '42501'; end if;
  delete from public.ordenes_compra where numero = p_numero;
end $$;

-- ---------- Configuración (admin) ----------
create or replace function public.oc_config_guardar(p_autorizadores uuid[], p_reparto_auto boolean, p_horas int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  update public.ordenes_compra_config
     set autorizadores = coalesce(p_autorizadores, '{}'), reparto_auto = coalesce(p_reparto_auto, true),
         horas_espera = coalesce(p_horas, 4), actualizada_at = now()
   where id = 1;
end $$;

-- Contactos de la agenda para elegir autorizadores (admin; sin teléfono completo)
create or replace function public.oc_contactos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'fin', right(telefono, 4), 'activo', activo) order by nombre), '[]')
            from public.informes_contactos);
end $$;

-- ---------- Pedir autorización (lo llama api/informe.ts con el JWT del usuario) ----------
-- Valida, marca la OC como pedida, deja los envíos en cola y devuelve qué mandar.
create or replace function public.oc_pedir_autorizacion(p_numero int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes_compra;
  d jsonb;
  envios jsonb;
begin
  select * into o from public.ordenes_compra where numero = p_numero for update;
  if o.numero is null then raise exception 'No existe la OC %', p_numero; end if;
  if not (private.tengo_permiso('ordenes_compra.compras') or (o.creada_por = auth.uid() and private.tengo_permiso('ordenes_compra.view'))) then
    raise exception 'Solo Compras o quien cargó la OC pueden pedir la autorización' using errcode = '42501';
  end if;
  if o.pasos ? 'autor' then raise exception 'La OC ya está autorizada'; end if;
  if o.cancelada_at is not null then raise exception 'La OC está cancelada'; end if;
  d := private.oc_destinatarios(p_numero);
  if jsonb_array_length(d -> 'contactos') = 0 then
    raise exception 'No hay autorizadores: el admin los elige en «Autorizadores» (de los contactos de Envío informes y reportes)';
  end if;
  with ins as (
    insert into public.ordenes_compra_whatsapp (numero, contacto_id, nombre, telefono, motivo)
    select p_numero, (x ->> 'id')::uuid, x ->> 'nombre', x ->> 'telefono', 'pedido'
      from jsonb_array_elements(d -> 'contactos') x
    returning id, nombre, telefono
  )
  select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'telefono', telefono)) into envios from ins;
  update public.ordenes_compra
     set pedida_at = now(), pedida_por = private.oc_mi_nombre(),
         pedida_a = (select array_agg(x ->> 'nombre') from jsonb_array_elements(d -> 'contactos') x),
         ampliada_at = null, actualizada_at = now()
   where numero = p_numero;
  perform private.oc_evento(p_numero, format('pidió la autorización por WhatsApp a %s',
    (select string_agg(x ->> 'nombre', ', ') from jsonb_array_elements(d -> 'contactos') x)));
  return jsonb_build_object('envios', envios, 'oc', jsonb_build_object(
    'numero', o.numero, 'tipo', o.tipo, 'proveedor', o.proveedor, 'monto', o.monto_bruto,
    'observacion', o.observacion, 'cargo', coalesce(o.creada_por_nombre, o.responsable)));
end $$;

-- Solo servidor (service role): OC pedidas sin respuesta pasadas las horas de espera → avisos para los demás
create or replace function public.oc_ampliar_avisos() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  d jsonb;
  out jsonb := '[]';
  envios jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Solo servidor' using errcode = '42501'; end if;
  for r in
    select o.* from public.ordenes_compra o, public.ordenes_compra_config c
     where c.id = 1 and o.pedida_at is not null and o.ampliada_at is null
       and not (o.pasos ? 'autor') and o.cancelada_at is null
       and o.pedida_at < now() - make_interval(hours => c.horas_espera)
     for update of o skip locked
  loop
    d := private.oc_destinatarios(r.numero);
    update public.ordenes_compra set ampliada_at = now() where numero = r.numero;
    if jsonb_array_length(d -> 'resto') = 0 then continue; end if;
    with ins as (
      insert into public.ordenes_compra_whatsapp (numero, contacto_id, nombre, telefono, motivo)
      select r.numero, (x ->> 'id')::uuid, x ->> 'nombre', x ->> 'telefono', 'ampliado'
        from jsonb_array_elements(d -> 'resto') x
      returning id, nombre, telefono
    )
    select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'telefono', telefono)) into envios from ins;
    insert into public.ordenes_compra_eventos (numero, por, texto)
    values (r.numero, 'sistema', format('nadie respondió en %s h: el aviso les llegó también a %s', d ->> 'horas',
      (select string_agg(x ->> 'nombre', ', ') from jsonb_array_elements(d -> 'resto') x)));
    out := out || jsonb_build_array(jsonb_build_object('envios', envios, 'oc', jsonb_build_object(
      'numero', r.numero, 'tipo', r.tipo, 'proveedor', r.proveedor, 'monto', r.monto_bruto,
      'observacion', r.observacion, 'cargo', coalesce(r.creada_por_nombre, r.responsable))));
  end loop;
  return out;
end $$;

-- Solo servidor: respuesta de un botón del WhatsApp. payload = 'OC|<id del envío>|SI|NO'
create or replace function public.oc_responder_whatsapp(p_telefono text, p_payload text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  partes text[] := string_to_array(coalesce(p_payload, ''), '|');
  e public.ordenes_compra_whatsapp;
  o public.ordenes_compra;
  si boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Solo servidor' using errcode = '42501'; end if;
  if array_length(partes, 1) <> 3 or partes[1] <> 'OC' or partes[3] not in ('SI', 'NO') or partes[2] !~ '^\d+$' then
    return jsonb_build_object('ok', false, 'mensaje', 'Respuesta no reconocida');
  end if;
  select * into e from public.ordenes_compra_whatsapp where id = partes[2]::bigint;
  -- El que responde tiene que ser el mismo número al que se le mandó
  if e.id is null or regexp_replace(e.telefono, '\D', '', 'g') <> regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g') then
    return jsonb_build_object('ok', false, 'mensaje', 'Respuesta no reconocida');
  end if;
  select * into o from public.ordenes_compra where numero = e.numero for update;
  update public.ordenes_compra_whatsapp set respuesta = partes[3], respondio_at = now() where id = e.id;
  if o.pasos ? 'autor' then
    return jsonb_build_object('ok', true, 'numero', o.numero, 'mensaje', format('La OC %s ya estaba autorizada por %s.', o.numero, o.pasos -> 'autor' ->> 'por'));
  end if;
  if o.cancelada_at is not null then
    return jsonb_build_object('ok', true, 'numero', o.numero, 'mensaje', format('La OC %s ya estaba cancelada o no autorizada.', o.numero));
  end if;
  si := partes[3] = 'SI';
  if si then
    update public.ordenes_compra
       set pasos = pasos || jsonb_build_object('autor', jsonb_build_object('por', e.nombre, 'at', now(), 'via', 'whatsapp')),
           actualizada_at = now()
     where numero = o.numero;
    insert into public.ordenes_compra_eventos (numero, por, texto) values (o.numero, e.nombre, 'autorizó la OC por WhatsApp');
    return jsonb_build_object('ok', true, 'numero', o.numero, 'mensaje', format('Listo: la OC %s quedó autorizada. ¡Gracias!', o.numero));
  end if;
  update public.ordenes_compra
     set cancelada_at = now(), cancelada_por = e.nombre, cancelada_motivo = 'No autorizada (WhatsApp)', no_autorizada = true, actualizada_at = now()
   where numero = o.numero;
  insert into public.ordenes_compra_eventos (numero, por, texto) values (o.numero, e.nombre, 'NO autorizó la OC por WhatsApp');
  return jsonb_build_object('ok', true, 'numero', o.numero, 'mensaje', format('Listo: la OC %s quedó como no autorizada. Se le avisa a Compras.', o.numero));
end $$;

-- ---------- Dragon ----------
create or replace function public.oc_mandar_dragon(p_numero int) returns void
language plpgsql security definer set search_path = public as $$
declare o public.ordenes_compra;
begin
  if not private.tengo_permiso('ordenes_compra.compras') then raise exception 'Solo Compras puede crear la OC en Dragon' using errcode = '42501'; end if;
  select * into o from public.ordenes_compra where numero = p_numero for update;
  if o.numero is null then raise exception 'No existe la OC %', p_numero; end if;
  if not o.dragon then raise exception 'La OC no tiene tildado «Esta OC va a Dragon»'; end if;
  if o.dragon_estado in ('enviando', 'ok') then raise exception 'La OC ya se mandó a Dragon'; end if;
  if coalesce(o.dragon_proveedor, '') = '' then raise exception 'Falta el proveedor de Dragon'; end if;
  if coalesce(o.dragon_motivo, '') = '' then raise exception 'Falta el motivo (es obligatorio en Dragon)'; end if;
  if o.dragon_base not in ('INDOD') then raise exception 'Por ahora solo se puede mandar a DRAGONFISH_INDOD'; end if;
  if not exists (select 1 from jsonb_array_elements(o.dragon_items) i
                  where coalesce(i ->> 'articulo', '') <> '' and coalesce((i ->> 'cantidad')::numeric, 0) > 0) then
    raise exception 'Cargá al menos un artículo con cantidad';
  end if;
  update public.ordenes_compra set dragon_estado = 'pendiente', dragon_error = null, dragon_por = private.oc_mi_nombre(), actualizada_at = now()
   where numero = p_numero;
  perform private.oc_evento(p_numero, format('mandó la OC a Dragon (DRAGONFISH_%s)', o.dragon_base));
end $$;

-- Puente (cada 1 min): toma las OC en cola
create or replace function public.oc_tomar_para_dragon(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not private.clave_sync_ok('puente', p_token) then raise exception 'Token inválido' using errcode = '42501'; end if;
  with tomadas as (
    update public.ordenes_compra o set dragon_estado = 'enviando'
     where o.numero in (select numero from public.ordenes_compra where dragon_estado = 'pendiente' order by numero limit 10 for update skip locked)
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'numero', numero, 'base', dragon_base, 'proveedor', dragon_proveedor, 'motivo', dragon_motivo,
    'condicion', dragon_condicion, 'lista', dragon_lista, 'fecha', coalesce(fecha_compra, current_date),
    'fecha_entrega', fecha_entrega, 'observacion', observacion, 'por', dragon_por, 'items', dragon_items)), '[]')
  into out from tomadas;
  return out;
end $$;

create or replace function public.oc_resultado_dragon(p_token text, p_numero int, p_codigo text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.clave_sync_ok('puente', p_token) then raise exception 'Token inválido' using errcode = '42501'; end if;
  if p_error is null then
    update public.ordenes_compra set dragon_estado = 'ok', dragon_codigo = p_codigo, dragon_error = null, dragon_at = now(), actualizada_at = now()
     where numero = p_numero;
    insert into public.ordenes_compra_eventos (numero, por, texto)
    values (p_numero, 'Dragon', format('quedó creada en Dragon: pedido de compra X-0164-%s', p_numero));
  else
    update public.ordenes_compra set dragon_estado = 'error', dragon_error = left(p_error, 500), actualizada_at = now() where numero = p_numero;
    insert into public.ordenes_compra_eventos (numero, por, texto) values (p_numero, 'Dragon', format('Dragon la rechazó: %s', left(p_error, 300)));
  end if;
end $$;

-- ---------- Archivos (bucket privado) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ordenes-compra', 'ordenes-compra', false, 15728640,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ordenes_compra_archivos_leer on storage.objects;
drop policy if exists ordenes_compra_archivos_subir on storage.objects;
create policy ordenes_compra_archivos_leer on storage.objects for select to authenticated
  using (bucket_id = 'ordenes-compra' and private.tengo_permiso('ordenes_compra.view'));
create policy ordenes_compra_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'ordenes-compra' and private.tengo_permiso('ordenes_compra.view'));

-- ---------- Grants ----------
revoke all on function public.oc_ampliar_avisos() from public, anon, authenticated;
revoke all on function public.oc_responder_whatsapp(text, text) from public, anon, authenticated;
grant execute on function public.oc_ampliar_avisos() to service_role;
grant execute on function public.oc_responder_whatsapp(text, text) to service_role;
grant execute on function public.oc_reparto() to authenticated;
grant execute on function public.oc_sugerido(int) to authenticated;
grant execute on function public.oc_guardar(jsonb) to authenticated;
grant execute on function public.oc_obs_propias(int, text) to authenticated;
grant execute on function public.oc_paso(int, text, boolean) to authenticated;
grant execute on function public.oc_cancelar(int, text, boolean) to authenticated;
grant execute on function public.oc_borrar(int) to authenticated;
grant execute on function public.oc_config_guardar(uuid[], boolean, int) to authenticated;
grant execute on function public.oc_contactos() to authenticated;
grant execute on function public.oc_pedir_autorizacion(int) to authenticated;
grant execute on function public.oc_mandar_dragon(int) to authenticated;
grant execute on function public.oc_tomar_para_dragon(text) to anon, authenticated;
grant execute on function public.oc_resultado_dragon(text, int, text, text) to anon, authenticated;

-- Proveedores de DRAGONFISH_INDOD (sembrados para Recepción INDO): también los busca la OC al mandarla a Dragon
drop policy if exists recepcion_indo_prov_ver_oc on public.recepcion_indo_proveedores;
create policy recepcion_indo_prov_ver_oc on public.recepcion_indo_proveedores for select to authenticated
  using ((select private.tengo_permiso('ordenes_compra.view')));
