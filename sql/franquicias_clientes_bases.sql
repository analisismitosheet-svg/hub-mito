-- ============================================================
-- Franquicias: cliente -> base de datos (y su sucursal de stock)
-- Aplicado: (pendiente)
--
--   1. franquicias_bases      : catálogo de bases Dragonfish. Cada base dice
--                               de qué sucursal de vw_STOCK_SUCURSALES_REAL
--                               se lee el stock del cliente.
--   2. franquicias_clientes   : asocia cada cliente (ZooLogic.CLI.CLCOD) a su base.
--      Con eso la reposición lee venta y stock de la BASE del cliente elegido.
-- ============================================================

-- Catálogo de bases. "base" = nombre de la base en Dragonfish (ej. DRAGONFISH_CFU).
-- "sucursal" = BD_ORIGEN en vw_STOCK_SUCURSALES_REAL (ej. CAPTAIN FIN USHUAIA).
create table if not exists public.franquicias_bases (
  base      text primary key,                 -- DRAGONFISH_CFU
  sucursal  text,                             -- CAPTAIN FIN USHUAIA
  nombre    text,                             -- CF Ushuaia
  activa    boolean not null default true,
  creado_at timestamptz not null default now()
);

-- Asociación cliente (ID Cliente de MITO, ZooLogic.CLI.CLCOD) -> base.
create table if not exists public.franquicias_clientes (
  cliente_id text primary key,                -- 01140
  base       text not null references public.franquicias_bases(base) on update cascade,
  creado_at  timestamptz not null default now(),
  creado_por uuid
);

-- Semilla: base en uso hoy.
insert into public.franquicias_bases (base, sucursal, nombre)
values ('DRAGONFISH_CFU', 'CAPTAIN FIN USHUAIA', 'CF Ushuaia')
on conflict (base) do nothing;

-- Semilla: cliente actual.
insert into public.franquicias_clientes (cliente_id, base)
values ('01140', 'DRAGONFISH_CFU')
on conflict (cliente_id) do nothing;

-- ---------------------------------------------------------------------------
-- Permisos: mismo patrón que Franquicias
-- ---------------------------------------------------------------------------
alter table public.franquicias_bases enable row level security;
alter table public.franquicias_clientes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['franquicias_bases', 'franquicias_clientes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_hub', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.tengo_permiso(''mayorista.franquicias.view'')) with check (private.tengo_permiso(''mayorista.franquicias.view''))',
      t || '_hub', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RPCs de apoyo
-- ---------------------------------------------------------------------------
create or replace function public.franquicias_asignar_base(p_cliente text, p_base text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not (private.tengo_permiso('mayorista.franquicias.view') or private.tengo_permiso('mayorista.repos_piso')) then
    raise exception 'sin permiso';
  end if;
  if p_base is null or p_base = '' then
    delete from public.franquicias_clientes where cliente_id = p_cliente;
  else
    insert into public.franquicias_clientes (cliente_id, base, creado_por)
    values (p_cliente, p_base, auth.uid())
    on conflict (cliente_id) do update set base = excluded.base, creado_por = auth.uid();
  end if;
end $$;

create or replace function public.franquicias_bases_mapa()
returns jsonb language sql security invoker set search_path = public as $$
  select jsonb_build_object(
    'bases', coalesce((select jsonb_agg(jsonb_build_object(
        'base', base, 'sucursal', sucursal, 'nombre', nombre, 'activa', activa)
        order by base) from public.franquicias_bases), '[]'::jsonb),
    'clientes', coalesce((select jsonb_object_agg(cliente_id, base)
        from public.franquicias_clientes), '{}'::jsonb)
  );
$$;
