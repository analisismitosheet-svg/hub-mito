-- Órdenes de compras: Administración también tilda los pasos de Compras (16/11/2026)
--   ordenes_compra.tildar  → validar compras, enviada y aceptada (sin editar, cancelar ni Dragon)
--   El rol administracion lo recibe; la autorización financiera sigue siendo de ordenes_compra.autorizar.
--   Excepción: Cecilia (contabilidad, rol administracion) también autoriza → grant por usuario.

insert into public.permisos (clave, modulo, accion, label, orden) values
  ('ordenes_compra.tildar', 'ordenes_compra', 'mark', 'Órdenes de compras: tildar validación, enviada y aceptada', 965)
on conflict (clave) do update set label = excluded.label, orden = excluded.orden;

insert into public.rol_permisos (rol, permiso_clave) values ('administracion', 'ordenes_compra.tildar')
on conflict do nothing;

insert into public.usuario_permisos (usuario_id, permiso_clave, efecto)
select id, 'ordenes_compra.autorizar', 'grant' from public.usuarios
 where id = 'cff2bfc4-740e-4c90-bd52-79e56eaf7f36'  -- Cecilia (contabilidad@)
   and not exists (select 1 from public.usuario_permisos up
                    where up.usuario_id = 'cff2bfc4-740e-4c90-bd52-79e56eaf7f36' and up.permiso_clave = 'ordenes_compra.autorizar');

create or replace function public.oc_paso(p_numero int, p_paso text, p_hecho boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes_compra;
  permiso text := case p_paso
    when 'valid' then 'ordenes_compra.compras' when 'env' then 'ordenes_compra.compras' when 'acep' then 'ordenes_compra.compras'
    when 'autor' then 'ordenes_compra.autorizar'
    when 'f_oc' then 'ordenes_compra.flexxus' when 'f_rem' then 'ordenes_compra.flexxus' when 'f_fac' then 'ordenes_compra.flexxus' end;
  nombres jsonb := '{"valid":"Validación Dto. Compras","autor":"Autorización financiera","env":"Enviada al proveedor","acep":"Aceptada por el proveedor","f_oc":"OC cargada en Flexxus","f_rem":"Remito cargado en Flexxus","f_fac":"Factura cargada en Flexxus"}';
begin
  if permiso is null then raise exception 'Paso inválido'; end if;
  if not (private.tengo_permiso(permiso)
          or (p_paso in ('valid', 'env', 'acep') and private.tengo_permiso('ordenes_compra.tildar'))) then
    raise exception 'No tenés permiso para este paso' using errcode = '42501';
  end if;
  select * into o from public.ordenes_compra where numero = p_numero for update;
  if o.numero is null then raise exception 'No existe la OC %', p_numero; end if;
  if o.cancelada_at is not null and p_hecho then raise exception 'La OC está cancelada'; end if;
  if p_hecho then
    update public.ordenes_compra
       set pasos = pasos || jsonb_build_object(p_paso, jsonb_build_object('por', private.oc_mi_nombre(), 'uid', auth.uid(), 'at', now(), 'via', 'hub')),
           actualizada_at = now()
     where numero = p_numero;
    perform private.oc_evento(p_numero, format('tildó «%s»', nombres ->> p_paso));
  else
    update public.ordenes_compra set pasos = pasos - p_paso, actualizada_at = now() where numero = p_numero;
    perform private.oc_evento(p_numero, format('destildó «%s»', nombres ->> p_paso));
  end if;
  return (select pasos from public.ordenes_compra where numero = p_numero);
end $$;
