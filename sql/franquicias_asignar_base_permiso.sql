-- Clientes y bases: el permiso de Franquicias también puede asignar la base
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
