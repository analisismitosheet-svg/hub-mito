-- Stock valorizado (Administradores) — permiso propio (aplicado 2026-10-27)
--
-- La pantalla no escribe nada: el cálculo lo hace el Puente SQL contra las bases
-- DRAGONFISH_* (ver puente-sql/sql/stock-valorizado.sql) y el hub solo lo muestra.
-- Por eso alcanza con la clave del permiso: no hay tablas ni RLS que tocar.
--
-- No se le asigna a ningún rol: queda para los administradores (private.es_admin
-- pasa todos los permisos) y para quien se lo den a mano en Roles y permisos,
-- porque son números de plata de toda la empresa.

insert into public.permisos (clave, modulo, accion, label, orden)
values ('stock_valorizado.view', 'stock_valorizado', 'view', 'Ver Stock valorizado · unidades y plata a costo', 1510)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;
