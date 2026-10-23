-- ============================================================
-- Franquicias: teléfono de WhatsApp por cliente + guardado conjunto
-- Aplicado: 22/10/2026
--
--   La configuración de cliente -> base y teléfono vive en Sistemas.
--   `franquicias_bases_mapa()` devuelve también `telefonos` para que las
--   pantallas de Franquicias usen el WhatsApp configurado como contacto
--   principal de la propuesta.
-- ============================================================

-- Las RPCs de la app validan permisos con private.tengo_permiso(); el rol
-- authenticated necesita USAGE sobre el schema para poder invocarlas.
grant usage on schema private to authenticated;

alter table public.franquicias_clientes
  add column if not exists telefono text;

comment on column public.franquicias_clientes.telefono is
  'WhatsApp del cliente en formato internacional sin + (ej. 5492901400000). Se configura en Sistemas → Franquicias.';

-- ---------------------------------------------------------------------------
-- Mapa que consume la app: bases, clientes (cliente_id -> base) y teléfonos
-- ---------------------------------------------------------------------------
create or replace function public.franquicias_bases_mapa()
returns jsonb language sql security invoker set search_path = public as $$
  select jsonb_build_object(
    'bases', coalesce((select jsonb_agg(jsonb_build_object(
        'base', base, 'sucursal', sucursal, 'nombre', nombre, 'activa', activa)
        order by base) from public.franquicias_bases), '[]'::jsonb),
    'clientes', coalesce((select jsonb_object_agg(cliente_id, base)
        from public.franquicias_clientes), '{}'::jsonb),
    'telefonos', coalesce((select jsonb_object_agg(cliente_id, telefono)
        from public.franquicias_clientes
        where telefono is not null and btrim(telefono) <> ''), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Guarda base + teléfono en una sola operación.
-- Si p_base viene vacío se borra la asignación completa (incluido el teléfono).
-- ---------------------------------------------------------------------------
create or replace function public.franquicias_guardar_asignacion(
  p_cliente text,
  p_base text,
  p_telefono text default null
)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_tel text := nullif(btrim(coalesce(p_telefono, '')), '');
begin
  if not (private.tengo_permiso('mayorista.franquicias.view') or private.tengo_permiso('mayorista.repos_piso')) then
    raise exception 'sin permiso';
  end if;

  if p_base is null or btrim(p_base) = '' then
    delete from public.franquicias_clientes where cliente_id = p_cliente;
  else
    insert into public.franquicias_clientes (cliente_id, base, telefono, creado_por)
    values (p_cliente, btrim(p_base), v_tel, auth.uid())
    on conflict (cliente_id) do update
      set base = excluded.base,
          telefono = excluded.telefono,
          creado_por = auth.uid();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cambia solo el teléfono. Se usa al salir del campo (blur) para no pisar
-- una base que se esté cambiando al mismo tiempo.
-- ---------------------------------------------------------------------------
create or replace function public.franquicias_asignar_telefono(p_cliente text, p_telefono text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not (private.tengo_permiso('mayorista.franquicias.view') or private.tengo_permiso('mayorista.repos_piso')) then
    raise exception 'sin permiso';
  end if;

  update public.franquicias_clientes
     set telefono = nullif(btrim(coalesce(p_telefono, '')), '')
   where cliente_id = p_cliente;

  if not found then
    raise exception 'El cliente no tiene una base asignada';
  end if;
end $$;

revoke all on function public.franquicias_guardar_asignacion(text, text, text) from public;
grant execute on function public.franquicias_guardar_asignacion(text, text, text) to authenticated;
revoke all on function public.franquicias_asignar_telefono(text, text) from public;
grant execute on function public.franquicias_asignar_telefono(text, text) to authenticated;
