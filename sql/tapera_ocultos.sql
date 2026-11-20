-- Mayorista > Stock > Tapera: líneas de remito que se sacan a mano (20/11/2026).
-- Caso que lo originó: el cliente 00891 tiene en Dragon el remito 2620 sin facturar, pero esa
-- mercadería pasó a REPOLOC y Dragon no tiene ningún comprobante que lo vincule.
-- No se toca Dragon: el hub solo deja de sumar esas líneas (y se pueden volver a sumar).
-- Ver: mayorista.stock.view · Sacar/volver a sumar: mayorista.stock.ajustar (admin, o individual).

create table if not exists public.tapera_ocultos (
  remito     integer not null,
  cliente    text    not null,
  articulo   text    not null,
  color      text    not null,
  talle      text    not null,
  nota       text,
  por        uuid    default auth.uid(),
  por_nombre text,
  creado_at  timestamptz not null default now(),
  primary key (remito, cliente, articulo, color, talle)
);

alter table public.tapera_ocultos enable row level security;
revoke all on public.tapera_ocultos from anon, authenticated;
grant select, insert, delete on public.tapera_ocultos to authenticated;

drop policy if exists tapera_ocultos_ver on public.tapera_ocultos;
create policy tapera_ocultos_ver on public.tapera_ocultos for select to authenticated
  using (private.tengo_permiso('mayorista.stock.view'));
drop policy if exists tapera_ocultos_sacar on public.tapera_ocultos;
create policy tapera_ocultos_sacar on public.tapera_ocultos for insert to authenticated
  with check (private.tengo_permiso('mayorista.stock.ajustar'));
drop policy if exists tapera_ocultos_volver on public.tapera_ocultos;
create policy tapera_ocultos_volver on public.tapera_ocultos for delete to authenticated
  using (private.tengo_permiso('mayorista.stock.ajustar'));

insert into public.permisos (clave, modulo, accion, label, orden)
values ('mayorista.stock.ajustar', 'mayorista', 'stock.ajustar', 'Stock · sacar líneas de Tapera', 1022)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;
