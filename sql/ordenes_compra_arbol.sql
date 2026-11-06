-- Órdenes de compras: árbol de quién autoriza (decisión del 06/11/2026, maqueta mockups/oc-arbol-autorizadores.html).
-- Tipo principal (Producto, Gastos, Servicios, Talleres) → subtipos (Alquiler, Limpieza…) que arma el admin
-- en Autorizadores. En cada nodo se eligen una o varias personas de la agenda de «Envío informes y reportes».
-- Reemplaza el cuadro plano por categoría (sin filas «Gastos de <persona>»).
-- A quién va el aviso (oc_destinatarios), en orden:
--   1. los elegidos del subtipo de la OC        2. los elegidos del tipo (el subtipo vacío hereda)
--   3. si reparto_auto, el historial del tipo    4. todos los autorizadores tildados (respaldo)
-- La OC guarda subtipo_id; es obligatorio si el tipo tiene subtipos activos. Borrar un subtipo lo desactiva
-- (las OC que lo tienen lo conservan).
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_arbol.sql

create table if not exists public.ordenes_compra_subtipos (
  id             serial primary key,
  tipo           text not null check (tipo in ('Producto', 'Gastos', 'Servicios', 'Talleres')),
  nombre         text not null check (trim(nombre) <> ''),
  autorizadores  uuid[] not null default '{}',
  orden          int not null default 0,
  activo         boolean not null default true,
  actualizado_at timestamptz not null default now()
);
create unique index if not exists ordenes_compra_subtipos_nombre on public.ordenes_compra_subtipos (tipo, lower(trim(nombre))) where activo;
alter table public.ordenes_compra_subtipos enable row level security;
drop policy if exists oc_subtipos_ver on public.ordenes_compra_subtipos;
create policy oc_subtipos_ver on public.ordenes_compra_subtipos for select to authenticated
  using ((select private.tengo_permiso('ordenes_compra.view')));
revoke all on public.ordenes_compra_subtipos from anon;
revoke insert, update, delete on public.ordenes_compra_subtipos from authenticated;
grant select on public.ordenes_compra_subtipos to authenticated;

alter table public.ordenes_compra add column if not exists subtipo_id int references public.ordenes_compra_subtipos (id);

-- Subtipos de arranque (los de la maqueta, sin nadie elegido: heredan del tipo). Solo si la tabla está vacía.
insert into public.ordenes_compra_subtipos (tipo, nombre, orden)
select t.tipo, t.nombre, t.orden from (values
  ('Producto', 'Consignación', 1), ('Producto', 'Reposición', 2), ('Producto', 'Alquiler', 3),
  ('Gastos', 'Procesos de producción', 1), ('Gastos', 'Limpieza', 2), ('Gastos', 'Alquiler', 3), ('Gastos', 'Honorarios', 4),
  ('Gastos', 'Envíos (OCA, Epick)', 5), ('Gastos', 'Mantenimiento y lámparas', 6),
  ('Servicios', 'Vidrieras', 1), ('Servicios', 'Reparaciones', 2),
  ('Talleres', 'Confección', 1), ('Talleres', 'Terminado y planchado', 2), ('Talleres', 'Muestras', 3)
) t(tipo, nombre, orden)
where not exists (select 1 from public.ordenes_compra_subtipos);

-- Del cuadro anterior quedan solo las reglas por tipo
update public.ordenes_compra_config
   set reglas = coalesce((select jsonb_object_agg(key, value) from jsonb_each(reglas) where key like 'tipo:%'), '{}')
 where id = 1;

-- Guardar el árbol (solo admin):
-- p = [{tipo, autorizadores: [uuid], subs: [{id?, nombre, autorizadores: [uuid]}]}]
create or replace function public.oc_arbol_guardar(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  t jsonb;
  s jsonb;
  v_tipo text;
  v_ids int[];
  v_id int;
  n int;
  v_reglas jsonb := '{}';
  quienes uuid[];
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'Árbol inválido'; end if;
  for t in select * from jsonb_array_elements(p) loop
    v_tipo := t ->> 'tipo';
    if v_tipo not in ('Producto', 'Gastos', 'Servicios', 'Talleres') then raise exception 'Tipo inválido: %', v_tipo; end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into quienes
      from jsonb_array_elements_text(coalesce(t -> 'autorizadores', '[]')) x where x ~* '^[0-9a-f-]{36}$';
    if cardinality(quienes) > 0 then v_reglas := v_reglas || jsonb_build_object('tipo:' || v_tipo, to_jsonb(quienes)); end if;
    v_ids := '{}';
    n := 0;
    for s in select * from jsonb_array_elements(coalesce(t -> 'subs', '[]')) loop
      n := n + 1;
      if coalesce(trim(s ->> 'nombre'), '') = '' then raise exception 'Hay un subtipo de % sin nombre', v_tipo; end if;
      select coalesce(array_agg(distinct x::uuid), '{}') into quienes
        from jsonb_array_elements_text(coalesce(s -> 'autorizadores', '[]')) x where x ~* '^[0-9a-f-]{36}$';
      v_id := nullif(s ->> 'id', '')::int;
      if v_id is not null then
        update public.ordenes_compra_subtipos
           set nombre = trim(s ->> 'nombre'), autorizadores = quienes, orden = n, activo = true, actualizado_at = now()
         where id = v_id and tipo = v_tipo;
        if not found then v_id := null; end if;
      end if;
      if v_id is null then
        insert into public.ordenes_compra_subtipos (tipo, nombre, autorizadores, orden)
        values (v_tipo, trim(s ->> 'nombre'), quienes, n) returning id into v_id;
      end if;
      v_ids := v_ids || v_id;
    end loop;
    update public.ordenes_compra_subtipos set activo = false, actualizado_at = now()
     where tipo = v_tipo and activo and not (id = any (v_ids));
  end loop;
  update public.ordenes_compra_config set reglas = v_reglas, actualizada_at = now() where id = 1;
exception when unique_violation then
  raise exception 'Hay dos subtipos con el mismo nombre en el mismo tipo';
end $$;
grant execute on function public.oc_arbol_guardar(jsonb) to authenticated;

create or replace function private.oc_destinatarios(p_numero int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.ordenes_compra;
  cfg public.ordenes_compra_config;
  s public.ordenes_compra_subtipos;
  regla jsonb;
  motivo text;
  todos jsonb;
  agenda jsonb;
  elegido jsonb;
begin
  select * into o from public.ordenes_compra where numero = p_numero;
  select * into cfg from public.ordenes_compra_config where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono) order by c.nombre), '[]')
    into todos from public.informes_contactos c where c.id = any (cfg.autorizadores) and c.activo;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono) order by c.nombre), '[]')
    into agenda from public.informes_contactos c where c.activo;

  -- 1. Elegidos del subtipo
  if o.subtipo_id is not null then
    select * into s from public.ordenes_compra_subtipos where id = o.subtipo_id;
    if cardinality(s.autorizadores) > 0 then
      select coalesce(jsonb_agg(x), '[]') into elegido from jsonb_array_elements(agenda) x where (x ->> 'id')::uuid = any (s.autorizadores);
      motivo := format('elegido por el admin para %s › %s', o.tipo, s.nombre);
    end if;
  end if;
  -- 2. Elegidos del tipo (el subtipo vacío hereda)
  if coalesce(jsonb_array_length(elegido), 0) = 0 and cfg.reglas ? ('tipo:' || o.tipo) then
    select coalesce(jsonb_agg(x), '[]') into elegido from jsonb_array_elements(agenda) x
     where cfg.reglas -> ('tipo:' || o.tipo) ? (x ->> 'id');
    motivo := format('elegido por el admin para %s%s', o.tipo, case when s.id is not null then format(' (%s hereda del tipo)', s.nombre) else '' end);
  end if;
  -- 3. Historial del tipo
  if coalesce(jsonb_array_length(elegido), 0) = 0 and cfg.reparto_auto then
    regla := public.oc_reparto() -> 'tipo' -> o.tipo;
    if regla is not null then
      select coalesce(jsonb_agg(x), '[]') into elegido from jsonb_array_elements(todos) x
       where private.oc_clave_nombre(x ->> 'nombre') = regla ->> 'quien';
      motivo := format('de las OC de %s, %s autorizó %s de %s', o.tipo, initcap(regla ->> 'quien'), regla ->> 'n', regla ->> 'de');
    end if;
  end if;

  if coalesce(jsonb_array_length(elegido), 0) > 0 then
    return jsonb_build_object('contactos', elegido, 'motivo', motivo,
      'resto', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(todos) x where not (elegido @> jsonb_build_array(x))),
      'horas', cfg.horas_espera);
  end if;
  -- 4. Todos los tildados
  return jsonb_build_object('contactos', todos, 'motivo', null, 'resto', '[]'::jsonb, 'horas', cfg.horas_espera);
end $$;

-- Alta / edición con subtipo (misma función de sql/ordenes_compra.sql + subtipo_id)
create or replace function public.oc_guardar(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_num int := nullif(p ->> 'numero', '')::int;
  o public.ordenes_compra;
  es_compras boolean := private.tengo_permiso('ordenes_compra.compras');
  v_items jsonb := coalesce(p -> 'dragon_items', '[]'::jsonb);
  v_dragon boolean := coalesce((p ->> 'dragon')::boolean, false);
  v_monto numeric := nullif(p ->> 'monto_bruto', '')::numeric;
  v_sub int := nullif(p ->> 'subtipo_id', '')::int;
  s public.ordenes_compra_subtipos;
begin
  if not private.tengo_permiso('ordenes_compra.view') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if coalesce(p ->> 'tipo', '') not in ('Producto', 'Gastos', 'Servicios', 'Talleres') then raise exception 'Elegí el tipo de compra'; end if;
  if coalesce(trim(p ->> 'proveedor'), '') = '' then raise exception 'Falta el proveedor'; end if;
  -- Subtipo (árbol de autorizadores): tiene que ser del mismo tipo; obligatorio si el tipo tiene subtipos activos
  if v_sub is not null then
    select * into s from public.ordenes_compra_subtipos where id = v_sub;
    if s.id is null or s.tipo <> p ->> 'tipo' then raise exception 'El subtipo no corresponde al tipo de compra'; end if;
    if not s.activo and not exists (select 1 from public.ordenes_compra where numero = v_num and subtipo_id = v_sub) then
      raise exception 'Ese subtipo ya no existe: elegí otro';
    end if;
  elsif exists (select 1 from public.ordenes_compra_subtipos where tipo = p ->> 'tipo' and activo) then
    raise exception 'Elegí el subtipo';
  end if;
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
    subtipo_id = v_sub,
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
