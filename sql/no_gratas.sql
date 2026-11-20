-- =====================================================
-- LOCALES → TASA DE CONVERSIÓN → PERSONAS NO GRATAS (20/11/2026)
--
-- Un local carga 1 a 5 fotos de una persona que robó / agredió (sin nombre ni DNI)
-- con el motivo. La PC contadora (contador-camaras) va a sacar la huella de la cara
-- de esas fotos (columna huellas, la escribe con service_role) y, cuando alguien
-- parecido entra por una puerta, inserta un aviso en no_gratas_avisos. El local lo
-- ve en Tasa de conversión y marca «era ella» o «falsa alarma».
--
-- Permisos: conversion.view ve la lista entera (para reconocerla) y carga.
--   Los avisos: cada local ve los suyos; contador.ver_todo / admin ven todos.
--   Editar / dar de baja: el local que la cargó, contador.ver_todo o admin.
-- Fotos: bucket privado `no-gratas` (createSignedUrl). Vencen solas (vence).
-- Datos biométricos (Ley 25.326): solo prevención interna, nunca públicos.
-- Idempotente.
-- =====================================================

create table if not exists public.no_gratas (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  local text not null,                 -- local que la cargó (public.locales.codigo)
  cargado_por uuid default auth.uid(),
  cargado_email text,
  fecha_hecho date not null default current_date,
  motivo text not null check (motivo in ('hurto', 'intento_hurto', 'agresion', 'otro')),
  descripcion text not null default '',
  fotos text[] not null default '{}',  -- rutas en el bucket no-gratas
  vence date not null,
  activa boolean not null default true,
  baja_at timestamptz,
  baja_email text,
  huellas jsonb,                       -- vectores de cara (los escribe la PC contadora)
  huellas_at timestamptz
);
create index if not exists no_gratas_activa_idx on public.no_gratas (activa, vence);

create table if not exists public.no_gratas_avisos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  no_grata_id bigint not null references public.no_gratas(id) on delete cascade,
  local text not null,                 -- local donde entró
  camara text,
  parecido numeric(5,2),               -- 0 a 100
  captura text,                        -- ruta en el bucket no-gratas (recorte de la cámara)
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmado', 'falsa_alarma')),
  resuelto_at timestamptz,
  resuelto_email text
);
create index if not exists no_gratas_avisos_local_idx on public.no_gratas_avisos (local, created_at desc);

-- ---------- RLS ----------
create or replace function private.no_gratas_puede_editar(p_local text)
returns boolean language sql stable security definer set search_path = public as $$
  select private.es_admin() or private.tiene_permiso('contador.ver_todo')
      or (private.tiene_permiso('conversion.view') and upper(p_local) = upper(coalesce(private.mi_local(), '')))
$$;
revoke all on function private.no_gratas_puede_editar(text) from public, anon;
grant execute on function private.no_gratas_puede_editar(text) to authenticated;

alter table public.no_gratas enable row level security;
alter table public.no_gratas_avisos enable row level security;

drop policy if exists no_gratas_ver on public.no_gratas;
create policy no_gratas_ver on public.no_gratas for select to authenticated
  using (private.es_admin() or private.tiene_permiso('conversion.view') or private.tiene_permiso('contador.ver_todo'));

drop policy if exists no_gratas_avisos_ver on public.no_gratas_avisos;
create policy no_gratas_avisos_ver on public.no_gratas_avisos for select to authenticated
  using (private.es_admin() or private.contador_puede_ver(local));

-- Escritura solo por las funciones de abajo (y la PC con service_role)
revoke insert, update, delete on public.no_gratas, public.no_gratas_avisos from anon, authenticated;
grant select on public.no_gratas, public.no_gratas_avisos to authenticated;

-- ---------- Cargar ----------
create or replace function public.no_grata_crear(
  p_motivo text, p_descripcion text, p_fotos text[], p_fecha_hecho date default current_date,
  p_meses int default 6, p_local text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_local text := private.mi_local();
  v_id bigint;
begin
  if not (private.es_admin() or private.tiene_permiso('conversion.view')) then
    raise exception 'Sin permiso para cargar' using errcode = '42501';
  end if;
  if (private.es_admin() or private.tiene_permiso('contador.ver_todo')) and nullif(trim(coalesce(p_local, '')), '') is not null then
    v_local := upper(trim(p_local));
  end if;
  if v_local is null then raise exception 'Elegí el local que la carga'; end if;
  if not exists (select 1 from public.locales where codigo = v_local) then raise exception 'Local desconocido: %', v_local; end if;
  if coalesce(array_length(p_fotos, 1), 0) = 0 then raise exception 'Subí al menos una foto'; end if;
  if array_length(p_fotos, 1) > 5 then raise exception 'Hasta 5 fotos'; end if;
  if lower(p_motivo) not in ('hurto', 'intento_hurto', 'agresion', 'otro') then raise exception 'Elegí un motivo'; end if;
  if p_meses not in (3, 6, 12) then raise exception 'Vencimiento inválido'; end if;

  insert into public.no_gratas (local, cargado_email, fecha_hecho, motivo, descripcion, fotos, vence)
  values (v_local, (select email from public.usuarios where id = auth.uid()), coalesce(p_fecha_hecho, current_date),
          lower(p_motivo), trim(coalesce(p_descripcion, '')), p_fotos,
          (coalesce(p_fecha_hecho, current_date) + make_interval(months => p_meses))::date)
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Dar de baja ----------
create or replace function public.no_grata_baja(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_local text;
begin
  select local into v_local from public.no_gratas where id = p_id;
  if v_local is null then raise exception 'No existe'; end if;
  if not private.no_gratas_puede_editar(v_local) then
    raise exception 'Solo la puede dar de baja el local que la cargó' using errcode = '42501';
  end if;
  update public.no_gratas set activa = false, baja_at = now(),
         baja_email = (select email from public.usuarios where id = auth.uid())
   where id = p_id;
end $$;

-- ---------- Resolver un aviso ----------
create or replace function public.no_grata_aviso_resolver(p_id bigint, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare v_local text;
begin
  if p_estado not in ('confirmado', 'falsa_alarma', 'pendiente') then raise exception 'Estado inválido'; end if;
  select local into v_local from public.no_gratas_avisos where id = p_id;
  if v_local is null then raise exception 'No existe'; end if;
  if not (private.es_admin() or private.contador_puede_ver(v_local)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  update public.no_gratas_avisos
     set estado = p_estado,
         resuelto_at = case when p_estado = 'pendiente' then null else now() end,
         resuelto_email = case when p_estado = 'pendiente' then null else (select email from public.usuarios where id = auth.uid()) end
   where id = p_id;
end $$;

revoke all on function public.no_grata_crear(text, text, text[], date, int, text) from public, anon;
revoke all on function public.no_grata_baja(bigint) from public, anon;
revoke all on function public.no_grata_aviso_resolver(bigint, text) from public, anon;
grant execute on function public.no_grata_crear(text, text, text[], date, int, text) to authenticated;
grant execute on function public.no_grata_baja(bigint) to authenticated;
grant execute on function public.no_grata_aviso_resolver(bigint, text) to authenticated;

-- ---------- Fotos (bucket privado) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('no-gratas', 'no-gratas', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists no_gratas_fotos_leer on storage.objects;
drop policy if exists no_gratas_fotos_subir on storage.objects;
create policy no_gratas_fotos_leer on storage.objects for select to authenticated
  using (bucket_id = 'no-gratas' and (private.es_admin() or private.tiene_permiso('conversion.view') or private.tiene_permiso('contador.ver_todo')));
create policy no_gratas_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'no-gratas' and (private.es_admin() or private.tiene_permiso('conversion.view')));
