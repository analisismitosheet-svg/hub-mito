-- Tienda mayorista (cf-zimith-mayorista.vercel.app): lo que es SOLO DE LA WEB de cada artículo.
-- Dragon sigue siendo la fuente de código, nombre, precio y stock; acá va lo que Dragon no tiene.
-- 26/11/2026. Tabla CERRADA (RLS sin políticas, sin permisos para anon/authenticated): solo service_role,
-- desde src/lib/tiendaProductosApi.ts del hub.

create table if not exists public.tienda_productos (
  marca text not null check (marca in ('captainfin', 'zimith')),
  codigo text not null check (codigo ~ '^[A-Z0-9!._/-]{1,40}$'),
  -- false = no se muestra en la tienda
  visible boolean not null default true,
  -- null = lo que diga el catálogo; true/false = lo decidió el admin
  nuevo boolean,
  oferta boolean,
  -- pre-venta: se puede pedir antes de que llegue; pasa sola a stock cuando entra al depósito MITO
  preventa boolean not null default false,
  entrega text check (entrega is null or char_length(entrega) <= 40),
  -- sumar el stock real de los 17 locales (lo de un local entra con transferencia a MITO)
  suma_locales boolean not null default false,
  -- detalle de la ficha en Markdown (null = el que venía del catálogo)
  detalle text check (detalle is null or char_length(detalle) <= 20000),
  actualizado_at timestamptz not null default now(),
  actualizado_por text,
  primary key (marca, codigo)
);

alter table public.tienda_productos enable row level security;
revoke all on public.tienda_productos from anon, authenticated;
