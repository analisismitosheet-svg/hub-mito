-- Órdenes de compras: descuentos para el pedido de compra de Dragon (06/11/2026).
--   * % por renglón: clave "descuento" de cada ítem de dragon_items -> FacturaDetalle[].Descuento
--   * % general de la OC: columna dragon_descuento -> PorcentajeDescuento del pedido
-- El monto bruto pasa a ser: suma(cantidad * precio * (1 - desc. renglón)) * (1 - desc. general) * 1,21.
-- Redefine oc_guardar (base: sql/ordenes_compra_arbol.sql) y oc_tomar_para_dragon (base: sql/ordenes_compra.sql).
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_descuento.sql

alter table public.ordenes_compra add column if not exists dragon_descuento numeric not null default 0;

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
  v_desc numeric := least(greatest(coalesce(nullif(p ->> 'dragon_descuento', '')::numeric, 0), 0), 100);
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
  -- Con Dragon, el monto bruto es el total de los artículos con IVA (21 %), descontando el % de cada
  -- renglón ("descuento") y el % general de la OC (dragon_descuento), como lo calcula Dragon
  if v_dragon and jsonb_array_length(v_items) > 0 then
    select round(sum(coalesce((i ->> 'cantidad')::numeric, 0) * coalesce((i ->> 'precio')::numeric, 0)
                     * (1 - least(greatest(coalesce((i ->> 'descuento')::numeric, 0), 0), 100) / 100))
                 * (1 - v_desc / 100) * 1.21, 2)
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
    dragon_descuento = case when dragon_estado in ('enviando', 'ok') then dragon_descuento else v_desc end,
    actualizada_at = now()
  where numero = v_num;
  return v_num;
end $$;

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
    'fecha_entrega', fecha_entrega, 'observacion', observacion, 'por', dragon_por, 'items', dragon_items, 'descuento', coalesce(dragon_descuento, 0))), '[]')
  into out from tomadas;
  return out;
end $$;
