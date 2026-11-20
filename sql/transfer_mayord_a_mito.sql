-- Transferencias: MAYORD pasa a llamarse MITO (20/11/2026, pedido del usuario).
-- Todo renglón que entra con origen o destino MAYORD (Excel importado, Reparto manual,
-- Cascada, franquicias) se graba como MITO. Un solo lugar: trigger en transfer_items.
-- Los lotes viejos quedan como estaban; el sinónimo hace que MAYORD y MITO cuenten como
-- el mismo local en estadísticas y filtros (private.origenes_de).

create or replace function private.transfer_items_mayord_a_mito()
returns trigger language plpgsql set search_path = public as $$
begin
  if upper(btrim(coalesce(new.origen, ''))) = 'MAYORD' then new.origen := 'MITO'; end if;
  if upper(btrim(coalesce(new.destino, ''))) = 'MAYORD' then new.destino := 'MITO'; end if;
  return new;
end $$;

drop trigger if exists transfer_items_mayord_a_mito on public.transfer_items;
create trigger transfer_items_mayord_a_mito
  before insert or update of origen, destino on public.transfer_items
  for each row execute function private.transfer_items_mayord_a_mito();

insert into public.locales_sinonimos (nombre, grupo) values
  ('MAYORD', 'MITO'),
  ('MITO', 'MITO')
on conflict (nombre) do update set grupo = excluded.grupo;
