-- Órdenes de compras: datos de contacto de los proveedores, sacados del maestro de Dragon
-- (ZooLogic.PROV: CLCUIT, CLTLF, TLFM, CLEMAIL + ZooLogic.CONTPROVDET: primer contacto cargado).
-- Al elegir la razón social en el alta de una OC se completan CUIT, contacto, teléfono y mail
-- (solo los que están vacíos). Lo llena puente-sql/scripts/sync-pedidos-compra.js cada 1 hora
-- (lee DRAGONFISH_VCPD del SQL Server de la PC del puente). Solo lectura en Dragon.
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/ordenes_compra_proveedores.sql

create table if not exists public.ordenes_compra_proveedores (
  codigo text primary key,
  nombre text not null,
  cuit text,
  contacto text,
  telefono text,
  mail text,
  actualizado_at timestamptz not null default now()
);
alter table public.ordenes_compra_proveedores enable row level security;

drop policy if exists oc_proveedores_ver on public.ordenes_compra_proveedores;
create policy oc_proveedores_ver on public.ordenes_compra_proveedores for select to authenticated
  using ((select private.tengo_permiso('ordenes_compra.view')));
revoke all on public.ordenes_compra_proveedores from anon;
revoke insert, update, delete on public.ordenes_compra_proveedores from authenticated;
grant select on public.ordenes_compra_proveedores to authenticated;

-- Reemplaza el catálogo completo (los que ya no están en Dragon se borran del hub, nunca en Dragon).
create or replace function public.ordenes_compra_proveedores_sync(p_token text, p_filas jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not private.clave_sync_ok('puente', p_token) then
    raise exception 'Clave de sincronización inválida' using errcode = '28000';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) < 100 or jsonb_array_length(p_filas) > 20000 then
    raise exception 'Catálogo inválido' using errcode = '22023';
  end if;
  create temp table t_prov on commit drop as
    select distinct on (trim(f->>'codigo'))
           trim(f->>'codigo') codigo, trim(f->>'nombre') nombre,
           nullif(trim(f->>'cuit'), '') cuit, nullif(trim(f->>'contacto'), '') contacto,
           nullif(trim(f->>'telefono'), '') telefono, nullif(trim(f->>'mail'), '') mail
      from jsonb_array_elements(p_filas) f
     where coalesce(trim(f->>'codigo'), '') <> '' and coalesce(trim(f->>'nombre'), '') <> '';
  insert into public.ordenes_compra_proveedores as p (codigo, nombre, cuit, contacto, telefono, mail, actualizado_at)
  select codigo, nombre, cuit, contacto, telefono, mail, now() from t_prov
  on conflict (codigo) do update
    set nombre = excluded.nombre, cuit = excluded.cuit, contacto = excluded.contacto,
        telefono = excluded.telefono, mail = excluded.mail, actualizado_at = now()
    where (p.nombre, p.cuit, p.contacto, p.telefono, p.mail)
          is distinct from (excluded.nombre, excluded.cuit, excluded.contacto, excluded.telefono, excluded.mail);
  get diagnostics v_n = row_count;
  delete from public.ordenes_compra_proveedores p where not exists (select 1 from t_prov t where t.codigo = p.codigo);
  return v_n;
end $$;
revoke all on function public.ordenes_compra_proveedores_sync(text, jsonb) from public;
grant execute on function public.ordenes_compra_proveedores_sync(text, jsonb) to anon, authenticated;
