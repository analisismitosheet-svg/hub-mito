-- Órdenes de compras: el admin elige a mano quién autoriza cada categoría (pedido del 06/11/2026).
-- Autorizadores → cuadro «Quién autoriza cada categoría»: una fila por tipo (Producto, Servicios,
-- Talleres, Gastos el resto) y una por cada responsable de Gastos; en cada una se tildan uno o varios
-- autorizadores. Se guarda en ordenes_compra_config.reglas:
--   { "tipo:Producto": [uuid…], "tipo:Gastos": [uuid…], "gastos:TOMAS ROCA": [uuid…] }
-- A quién va el aviso (oc_destinatarios), en orden:
--   1. Gastos: la elección para ese responsable   2. si reparto_auto, el historial de ese responsable
--   3. la elección para el tipo                    4. si reparto_auto, el historial del tipo
--   5. todos los autorizadores tildados
-- Solo cuentan los elegidos que siguen tildados y activos. Si nadie responde en horas_espera,
-- oc_ampliar_avisos les manda a los demás (sin cambios).
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_reglas.sql

alter table public.ordenes_compra_config add column if not exists reglas jsonb not null default '{}';

drop function if exists public.oc_config_guardar(uuid[], boolean, int);
create or replace function public.oc_config_guardar(p_autorizadores uuid[], p_reparto_auto boolean, p_horas int, p_reglas jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare limpio jsonb := '{}';
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  if p_reglas is not null then
    if jsonb_typeof(p_reglas) <> 'object' then raise exception 'Reglas inválidas'; end if;
    -- Claves «tipo:X» o «gastos:RESPONSABLE» (en mayúsculas); valores = ids de contactos, sin vacíos
    select coalesce(jsonb_object_agg(k, v), '{}') into limpio from (
      select case when key like 'gastos:%' then 'gastos:' || upper(trim(substr(key, 8))) else key end k,
             (select jsonb_agg(distinct x) from jsonb_array_elements_text(value) x where x ~* '^[0-9a-f-]{36}$') v
        from jsonb_each(p_reglas)
       where jsonb_typeof(value) = 'array'
         and (key in ('tipo:Producto', 'tipo:Servicios', 'tipo:Talleres', 'tipo:Gastos')
              or (key like 'gastos:%' and trim(substr(key, 8)) <> ''))
    ) r where v is not null;
  end if;
  update public.ordenes_compra_config
     set autorizadores = coalesce(p_autorizadores, '{}'), reparto_auto = coalesce(p_reparto_auto, true),
         horas_espera = coalesce(p_horas, 4), reglas = case when p_reglas is null then reglas else limpio end,
         actualizada_at = now()
   where id = 1;
end $$;
grant execute on function public.oc_config_guardar(uuid[], boolean, int, jsonb) to authenticated;

create or replace function private.oc_destinatarios(p_numero int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  o public.ordenes_compra;
  cfg public.ordenes_compra_config;
  rep jsonb;
  regla jsonb;
  resp text;
  motivo text;
  todos jsonb;
  elegido jsonb;
begin
  select * into o from public.ordenes_compra where numero = p_numero;
  select * into cfg from public.ordenes_compra_config where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono) order by c.nombre), '[]')
    into todos
    from public.informes_contactos c where c.id = any (cfg.autorizadores) and c.activo;
  resp := upper(trim(coalesce(o.responsable, '')));
  if cfg.reparto_auto then rep := public.oc_reparto(); end if;

  -- 1. Elegidos a mano para los Gastos de ese responsable
  if o.tipo = 'Gastos' and resp <> '' and cfg.reglas ? ('gastos:' || resp) then
    select coalesce(jsonb_agg(x), '[]') into elegido from jsonb_array_elements(todos) x
     where cfg.reglas -> ('gastos:' || resp) ? (x ->> 'id');
    motivo := format('elegido por el admin para los Gastos de %s', initcap(lower(o.responsable)));
  end if;
  -- 2. Historial de ese responsable
  if coalesce(jsonb_array_length(elegido), 0) = 0 and rep is not null and o.tipo = 'Gastos' then
    regla := rep -> 'gastos_responsable' -> resp;
    if regla is not null then
      select coalesce(jsonb_agg(x), '[]') into elegido from jsonb_array_elements(todos) x
       where private.oc_clave_nombre(x ->> 'nombre') = regla ->> 'quien';
      motivo := format('de las OC de Gastos de %s, %s autorizó %s de %s', initcap(lower(o.responsable)), initcap(regla ->> 'quien'), regla ->> 'n', regla ->> 'de');
    end if;
  end if;
  -- 3. Elegidos a mano para el tipo
  if coalesce(jsonb_array_length(elegido), 0) = 0 and cfg.reglas ? ('tipo:' || o.tipo) then
    select coalesce(jsonb_agg(x), '[]') into elegido from jsonb_array_elements(todos) x
     where cfg.reglas -> ('tipo:' || o.tipo) ? (x ->> 'id');
    motivo := format('elegido por el admin para %s', case when o.tipo = 'Gastos' then 'Gastos (el resto)' else o.tipo end);
  end if;
  -- 4. Historial del tipo
  if coalesce(jsonb_array_length(elegido), 0) = 0 and rep is not null then
    regla := rep -> 'tipo' -> o.tipo;
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
  -- 5. Todos los tildados
  return jsonb_build_object('contactos', todos, 'motivo', null, 'resto', '[]'::jsonb, 'horas', cfg.horas_espera);
end $$;

-- Responsables con OC de Gastos (para «＋ Agregar persona» del cuadro; solo admin)
create or replace function public.oc_responsables_gastos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(r order by n desc, r), '[]') from (
    select upper(trim(responsable)) r, count(*) n from public.ordenes_compra
     where tipo = 'Gastos' and coalesce(trim(responsable), '') <> '' group by 1) t);
end $$;
grant execute on function public.oc_responsables_gastos() to authenticated;
