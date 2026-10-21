-- Franquicias: propuesta de reposición que el cliente elige por un link (aplicado 2026-10-16)
--   1. En Reposición sugerida se arma la propuesta (P-001) con sus artículos.
--   2. El hub le manda el link por WhatsApp a los contactos de la franquicia.
--   3. El cliente, sin usuario, marca sí/no y cantidades y confirma (RPCs públicas por token).
--   4. (pendiente) alta del pedido en Dragon por la API REST.
--   5. Aviso en la campana e historial en la pantalla.

create table if not exists public.franquicias_contactos (
  id uuid primary key default gen_random_uuid(),
  franquicia text not null,
  nombre text,
  telefono text not null,
  creado_at timestamptz not null default now()
);

create table if not exists public.franquicias_propuestas (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  franquicia text not null,
  franquicia_nombre text not null,
  token text unique not null default encode(extensions.gen_random_bytes(18), 'hex'),
  desde date,
  hasta date,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'enviada', 'confirmada', 'en_dragon', 'anulada')),
  vence_at timestamptz not null default now() + interval '7 days',
  unidades_propuestas integer not null default 0,
  total_propuesto numeric not null default 0,
  unidades_confirmadas integer,
  total_confirmado numeric,
  comentario text,
  envio_detalle text,
  enviada_at timestamptz,
  abierta_at timestamptz,
  confirmada_at timestamptz,
  revisada_at timestamptz,
  dragon_pedido text,
  dragon_error text,
  creado_por uuid default auth.uid(),
  creado_at timestamptz not null default now()
);

create table if not exists public.franquicias_propuesta_items (
  id bigserial primary key,
  propuesta_id uuid not null references public.franquicias_propuestas(id) on delete cascade,
  orden integer not null default 0,
  art text not null,
  descrip text,
  material text,
  color text,
  talle text,
  stock_cli integer not null default 0,
  vendido integer not null default 0,
  stock_mito integer not null default 0,
  sugerido integer not null default 0,
  precio numeric,
  elegido boolean,
  cantidad integer
);
create index if not exists franquicias_propuesta_items_prop on public.franquicias_propuesta_items (propuesta_id);

-- Número correlativo GLOBAL (sin la franquicia): P-001, P-002…
-- Se numera sobre todas las propuestas para que no se repita entre franquicias
-- (la columna `numero` es unique).
create or replace function private.numero_propuesta_franquicia()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext('franq-prop'));
    select coalesce(max(substring(numero from '(\d+)$')::integer), 0) + 1 into n
      from public.franquicias_propuestas;
    new.numero := 'P-' || lpad(n::text, 3, '0');
  end if;
  return new;
end $$;
drop trigger if exists franquicias_propuestas_numero on public.franquicias_propuestas;
create trigger franquicias_propuestas_numero before insert on public.franquicias_propuestas
  for each row execute function private.numero_propuesta_franquicia();

-- RLS: los del hub con acceso a Franquicias (permiso mayorista.franquicias.view) o admin
alter table public.franquicias_contactos enable row level security;
alter table public.franquicias_propuestas enable row level security;
alter table public.franquicias_propuesta_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['franquicias_contactos', 'franquicias_propuestas', 'franquicias_propuesta_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_hub', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.tengo_permiso(''mayorista.franquicias.view'')) with check (private.tengo_permiso(''mayorista.franquicias.view''))',
      t || '_hub', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Acceso público por link (el cliente no tiene usuario): sólo por token
-- ---------------------------------------------------------------------------

create or replace function public.propuesta_franquicia_publica(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.franquicias_propuestas;
begin
  select * into p from public.franquicias_propuestas where token = p_token and estado <> 'borrador' and estado <> 'anulada';
  if not found then return null; end if;
  if p.abierta_at is null then
    update public.franquicias_propuestas set abierta_at = now() where id = p.id;
  end if;
  return jsonb_build_object(
    'numero', p.numero,
    'franquicia', p.franquicia_nombre,
    'desde', p.desde,
    'hasta', p.hasta,
    'vence_at', p.vence_at,
    'vencida', p.estado = 'enviada' and p.vence_at < now(),
    'confirmada', p.estado in ('confirmada', 'en_dragon'),
    'confirmada_at', p.confirmada_at,
    'comentario', p.comentario,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'art', i.art, 'descrip', i.descrip, 'color', i.color, 'talle', i.talle,
        'sugerido', i.sugerido, 'vendido', i.vendido, 'maximo', i.stock_mito, 'precio', i.precio,
        'elegido', i.elegido, 'cantidad', i.cantidad) order by i.orden, i.id)
      from public.franquicias_propuesta_items i where i.propuesta_id = p.id), '[]'::jsonb)
  );
end $$;

create or replace function public.confirmar_propuesta_franquicia(p_token text, p_items jsonb, p_comentario text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.franquicias_propuestas;
  r record;
  uni integer := 0;
  tot numeric := 0;
begin
  select * into p from public.franquicias_propuestas where token = p_token for update;
  if not found or p.estado in ('borrador', 'anulada') then
    raise exception 'La propuesta no existe' using errcode = 'P0002';
  end if;
  if p.estado <> 'enviada' then
    raise exception 'Esta propuesta ya fue confirmada' using errcode = 'P0001';
  end if;
  if p.vence_at < now() then
    raise exception 'La propuesta venció: pedile a MITO una nueva' using errcode = 'P0001';
  end if;

  -- Lo que no viene en p_items queda como "no"
  update public.franquicias_propuesta_items set elegido = false, cantidad = 0 where propuesta_id = p.id;
  for r in select (e->>'id')::bigint as id, greatest(0, coalesce((e->>'cantidad')::integer, 0)) as cant
             from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e loop
    update public.franquicias_propuesta_items
       set cantidad = least(r.cant, stock_mito), elegido = least(r.cant, stock_mito) > 0
     where id = r.id and propuesta_id = p.id;
  end loop;

  select coalesce(sum(cantidad), 0), coalesce(sum(cantidad * coalesce(precio, 0)), 0) into uni, tot
    from public.franquicias_propuesta_items where propuesta_id = p.id;

  update public.franquicias_propuestas
     set estado = 'confirmada', confirmada_at = now(), unidades_confirmadas = uni, total_confirmado = tot,
         comentario = nullif(btrim(coalesce(p_comentario, '')), '')
   where id = p.id;

  return jsonb_build_object('ok', true, 'numero', p.numero, 'unidades', uni, 'total', tot);
end $$;

revoke all on function public.propuesta_franquicia_publica(text) from public;
revoke all on function public.confirmar_propuesta_franquicia(text, jsonb, text) from public;
grant execute on function public.propuesta_franquicia_publica(text) to anon, authenticated;
grant execute on function public.confirmar_propuesta_franquicia(text, jsonb, text) to anon, authenticated;
