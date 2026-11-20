-- Mayorista > Stock (/mayorista/stock): Depósito y Tapera de DRAGONFISH_MITO (20/11/2026).
-- Permiso propio, dado al rol Mayorista (el admin lo ve siempre).

insert into public.permisos (clave, modulo, accion, label, orden)
values ('mayorista.stock.view', 'mayorista', 'stock.view', 'Ver Stock · Depósito y Tapera', 1021)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;

insert into public.rol_permisos (rol, permiso_clave)
values ('mayorista', 'mayorista.stock.view')
on conflict do nothing;
