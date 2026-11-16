-- Cascada: guardar el tipo de cada renglón (VENTA o HUECO) en Transferencias (16/11/2026).
-- Hasta ahora private.cascada_crear_lote grababa siempre 'VENTA'. Con el pase de huecos
-- (puente-sql/cascada.js) cada item trae "tipo"; lo que no sea HUECO queda VENTA.
create or replace function private.cascada_crear_lote(p_nombre text, p_motivo text, p_items jsonb, p_uid uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_id uuid;
  v_n int;
  v_u int;
begin
  if coalesce(btrim(p_nombre), '') = '' then raise exception 'Falta el nombre del lote' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La cascada no tiene renglones' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 5000 then raise exception 'Demasiados renglones' using errcode = '22023'; end if;

  select id into v_id from public.transfer_lotes
   where nombre = btrim(p_nombre) and created_at > now() - interval '7 days'
   order by created_at desc limit 1;
  if v_id is not null then
    select count(*), coalesce(sum(cantidad), 0) into v_n, v_u from public.transfer_items where lote_id = v_id;
    return jsonb_build_object('id', v_id, 'repetido', true, 'renglones', v_n, 'unidades', v_u);
  end if;

  insert into public.transfer_lotes (nombre, motivo, subido_por)
  values (btrim(p_nombre), nullif(btrim(coalesce(p_motivo, '')), ''), p_uid)
  returning id into v_id;

  insert into public.transfer_items (lote_id, orden, origen, destino, articulo, descripcion, material, color, talle, tipo, cantidad)
  select v_id, (x.n - 1)::int,
         upper(btrim(x.f->>'origen')), upper(btrim(x.f->>'destino')),
         nullif(btrim(x.f->>'articulo'), ''), nullif(btrim(x.f->>'descripcion'), ''),
         nullif(btrim(x.f->>'material'), ''), nullif(btrim(x.f->>'color'), ''), nullif(btrim(x.f->>'talle'), ''),
         case when upper(btrim(coalesce(x.f->>'tipo', ''))) = 'HUECO' then 'HUECO' else 'VENTA' end,
         (x.f->>'cantidad')::int
    from jsonb_array_elements(p_items) with ordinality as x(f, n)
   where coalesce(btrim(x.f->>'origen'), '') <> '' and coalesce(btrim(x.f->>'destino'), '') <> ''
     and coalesce((x.f->>'cantidad')::int, 0) > 0;

  select count(*), coalesce(sum(cantidad), 0) into v_n, v_u from public.transfer_items where lote_id = v_id;
  return jsonb_build_object('id', v_id, 'repetido', false, 'renglones', v_n, 'unidades', v_u);
end $$;
revoke all on function private.cascada_crear_lote(text, text, jsonb, uuid) from public, anon, authenticated;
