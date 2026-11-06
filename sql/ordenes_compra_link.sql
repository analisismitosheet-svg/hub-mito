-- Órdenes de compras: autorizar desde un link del WhatsApp (como /p/:token de Reposición diaria),
-- protegido con una clave por autorizador.
-- Cada envío tiene su token: el link sabe a quién se le mandó, sin usuario del hub y sin webhook de Meta.
-- La clave la carga el admin en Autorizadores, se guarda encriptada y sin ella no se ve ningún dato de la OC.
-- A los 5 intentos errados seguidos se bloquea; el admin la desbloquea y sigue valiendo la misma.
-- Reemplaza a los botones de respuesta rápida (oc_responder_whatsapp), que nunca llegaron a usarse.

alter table public.ordenes_compra_whatsapp
  add column if not exists token text unique not null default encode(extensions.gen_random_bytes(18), 'hex');

-- El token solo lo lee el servidor: alguien con acceso a la tabla no puede sacar el link de otro.
revoke select on public.ordenes_compra_whatsapp from anon, authenticated;
grant select (id, numero, contacto_id, nombre, telefono, motivo, estado, detalle, wamid, respuesta, respondio_at, creado_at)
  on public.ordenes_compra_whatsapp to authenticated;

drop function if exists public.oc_responder_whatsapp(text, text);

-- Sin políticas ni permisos: solo se toca por las funciones de abajo.
create table if not exists public.ordenes_compra_claves (
  contacto_id    uuid primary key references public.informes_contactos (id) on delete cascade,
  hash           text not null,
  intentos       int not null default 0,
  bloqueada      boolean not null default false,
  actualizada_at timestamptz not null default now(),
  actualizada_por text
);
alter table public.ordenes_compra_claves enable row level security;
revoke all on public.ordenes_compra_claves from public, anon, authenticated;

-- ---------- Admin: cargar la clave y ver quién la tiene (nunca se puede leer) ----------
create or replace function public.oc_clave_guardar(p_contacto uuid, p_clave text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  if coalesce(p_clave, '') !~ '^\d{4,6}$' then raise exception 'La clave tiene que tener de 4 a 6 números'; end if;
  if not exists (select 1 from public.informes_contactos where id = p_contacto) then raise exception 'No existe el contacto'; end if;
  insert into public.ordenes_compra_claves (contacto_id, hash, actualizada_por)
  values (p_contacto, extensions.crypt(p_clave, extensions.gen_salt('bf')), private.oc_mi_nombre())
  on conflict (contacto_id) do update
    set hash = excluded.hash, intentos = 0, bloqueada = false, actualizada_at = now(), actualizada_por = excluded.actualizada_por;
end $$;

create or replace function public.oc_clave_desbloquear(p_contacto uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  update public.ordenes_compra_claves
     set intentos = 0, bloqueada = false, actualizada_at = now(), actualizada_por = private.oc_mi_nombre()
   where contacto_id = p_contacto;
end $$;

create or replace function public.oc_claves_estado() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.es_admin() then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('contacto_id', contacto_id, 'bloqueada', bloqueada)), '[]') from public.ordenes_compra_claves);
end $$;

-- ---------- Link público ----------
-- Lo único que se ve sin clave: el nombre para el saludo y si puede entrar.
drop function if exists public.oc_link_publica(text);
create or replace function public.oc_link_inicio(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e public.ordenes_compra_whatsapp;
  c public.ordenes_compra_claves;
begin
  select * into e from public.ordenes_compra_whatsapp where token = p_token;
  if e.id is null then return null; end if;
  select * into c from public.ordenes_compra_claves where contacto_id = e.contacto_id;
  return jsonb_build_object('nombre', e.nombre, 'tiene_clave', c.contacto_id is not null, 'bloqueada', coalesce(c.bloqueada, false));
end $$;

-- Controla la clave y cuenta los intentos. Devuelve el error en vez de lanzarlo:
-- una excepción desharía la suma del intento fallido.
create or replace function private.oc_link_control(p_token text, p_clave text, out envio public.ordenes_compra_whatsapp, out error text, out restantes int)
language plpgsql security definer set search_path = public as $$
declare
  c public.ordenes_compra_claves;
begin
  select * into envio from public.ordenes_compra_whatsapp where token = p_token;
  if envio.id is null then error := 'link'; return; end if;
  select * into c from public.ordenes_compra_claves where contacto_id = envio.contacto_id for update;
  if c.contacto_id is null then error := 'sin_clave'; return; end if;
  if c.bloqueada then error := 'bloqueada'; return; end if;
  if c.hash = extensions.crypt(coalesce(p_clave, ''), c.hash) then
    if c.intentos > 0 then update public.ordenes_compra_claves set intentos = 0 where contacto_id = c.contacto_id; end if;
    return;
  end if;
  update public.ordenes_compra_claves
     set intentos = intentos + 1, bloqueada = intentos + 1 >= 5
   where contacto_id = c.contacto_id
  returning 5 - intentos into restantes;
  error := case when restantes <= 0 then 'bloqueada' else 'clave' end;
end $$;

create or replace function private.oc_link_datos(e public.ordenes_compra_whatsapp) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nombre', e.nombre,
    'numero', o.numero, 'tipo', o.tipo, 'proveedor', o.proveedor, 'monto', o.monto_bruto,
    'observacion', o.observacion, 'cargo', coalesce(o.creada_por_nombre, o.responsable), 'area', o.area,
    'forma_pago', o.forma_pago, 'plazo', o.plazo, 'fecha_entrega', o.fecha_entrega, 'archivo_url', o.archivo_url,
    'items', case when o.dragon then o.dragon_items else '[]'::jsonb end,
    'autorizada_por', o.pasos -> 'autor' ->> 'por',
    'autorizada_at', o.pasos -> 'autor' ->> 'at',
    'cancelada_por', o.cancelada_por,
    'cancelada_at', o.cancelada_at,
    'no_autorizada', coalesce(o.no_autorizada, false))
  from public.ordenes_compra o where o.numero = e.numero;
$$;

-- Abrir la orden con la clave
create or replace function public.oc_link_abrir(p_token text, p_clave text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  select * into t from private.oc_link_control(p_token, p_clave);
  if t.error is not null then return jsonb_build_object('error', t.error, 'restantes', t.restantes); end if;
  return jsonb_build_object('oc', private.oc_link_datos(t.envio));
end $$;

-- La respuesta. Si otro ya respondió no cambia nada: la pantalla muestra quién fue.
create or replace function public.oc_link_responder(p_token text, p_clave text, p_autoriza boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record;
  e public.ordenes_compra_whatsapp;
  o public.ordenes_compra;
  motivo text := nullif(left(trim(coalesce(p_motivo, '')), 300), '');
begin
  select * into t from private.oc_link_control(p_token, p_clave);
  if t.error is not null then return jsonb_build_object('error', t.error, 'restantes', t.restantes); end if;
  e := t.envio;
  select * into o from public.ordenes_compra where numero = e.numero for update;
  if not (o.pasos ? 'autor') and o.cancelada_at is null then
    update public.ordenes_compra_whatsapp set respuesta = case when p_autoriza then 'SI' else 'NO' end, respondio_at = now() where id = e.id;
    if p_autoriza then
      update public.ordenes_compra
         set pasos = pasos || jsonb_build_object('autor', jsonb_build_object('por', e.nombre, 'at', now(), 'via', 'whatsapp')),
             actualizada_at = now()
       where numero = o.numero;
      insert into public.ordenes_compra_eventos (numero, por, texto) values (o.numero, e.nombre, 'autorizó la OC desde el link de WhatsApp');
    else
      update public.ordenes_compra
         set cancelada_at = now(), cancelada_por = e.nombre, no_autorizada = true, actualizada_at = now(),
             cancelada_motivo = coalesce('No autorizada: ' || motivo, 'No autorizada (WhatsApp)')
       where numero = o.numero;
      insert into public.ordenes_compra_eventos (numero, por, texto)
      values (o.numero, e.nombre, 'NO autorizó la OC desde el link de WhatsApp' || coalesce(': ' || motivo, ''));
    end if;
  end if;
  return jsonb_build_object('oc', private.oc_link_datos(e));
end $$;

revoke all on function public.oc_clave_guardar(uuid, text) from public, anon;
revoke all on function public.oc_clave_desbloquear(uuid) from public, anon;
revoke all on function public.oc_claves_estado() from public, anon;
revoke all on function public.oc_link_inicio(text) from public;
revoke all on function public.oc_link_abrir(text, text) from public;
revoke all on function public.oc_link_responder(text, text, boolean, text) from public;
revoke all on function private.oc_link_control(text, text) from public;
revoke all on function private.oc_link_datos(public.ordenes_compra_whatsapp) from public;
grant execute on function public.oc_clave_guardar(uuid, text) to authenticated;
grant execute on function public.oc_clave_desbloquear(uuid) to authenticated;
grant execute on function public.oc_claves_estado() to authenticated;
grant execute on function public.oc_link_inicio(text) to anon, authenticated;
grant execute on function public.oc_link_abrir(text, text) to anon, authenticated;
grant execute on function public.oc_link_responder(text, text, boolean, text) to anon, authenticated;
