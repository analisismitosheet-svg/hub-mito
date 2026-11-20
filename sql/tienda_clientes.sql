-- Tienda mayorista (cf-zimith-mayorista.vercel.app): clientes que se registran solos y el admin aprueba.
-- 20/11/2026. Tabla CERRADA: RLS prendido y sin políticas, sin permisos para anon/authenticated.
-- Solo la leen/escriben las funciones del hub con la service_role (src/lib/tiendaClientesApi.ts).
-- No usa el login (Auth) del hub: los clientes nunca quedan mezclados con los empleados.

create table if not exists public.tienda_clientes (
  id uuid primary key default gen_random_uuid(),
  -- número de Telegram normalizado como en telegram_vinculos (ej. 543512400630)
  telefono text not null unique check (telefono ~ '^\d{10,15}$'),
  comercio text not null check (char_length(comercio) between 2 and 80),
  contacto text not null check (char_length(contacto) between 2 and 80),
  cuit text check (cuit is null or cuit ~ '^\d{11}$'),
  mail text check (mail is null or char_length(mail) <= 120),
  localidad text check (localidad is null or char_length(localidad) <= 80),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  -- código de cliente en Dragon (lo pone el admin al aprobar)
  codigo_dragon text check (codigo_dragon is null or codigo_dragon ~ '^[A-Za-z0-9]{1,10}$'),
  -- marcas que ve y con qué lista: {"captainfin":"PR MAYORISTA","zimith":"PR MAYORISTA"}
  marcas jsonb not null default '{}'::jsonb check (jsonb_typeof(marcas) = 'object'),
  creado_at timestamptz not null default now(),
  revisado_at timestamptz,
  revisado_por text
);

alter table public.tienda_clientes enable row level security;
revoke all on public.tienda_clientes from anon, authenticated;

create index if not exists tienda_clientes_estado_idx on public.tienda_clientes (estado, creado_at desc);
