-- Administración > Flexxus — permiso propio (25/11/2026)
--
-- La pantalla no escribe nada: lee la base Firebird de Flexxus por el Puente SQL
-- (servidor vinculado FLEXXUS, solo lectura; ver puente-sql/flexxus.js).
-- No se le asigna a ningún rol: queda para los administradores (private.es_admin
-- pasa todos los permisos) y para quien se lo den en Roles y permisos, porque son
-- números contables y deuda de clientes.

insert into public.permisos (clave, modulo, accion, label, orden)
values ('flexxus.view', 'flexxus', 'view', 'Ver Flexxus · ventas, saldos de clientes y asientos', 1505)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;
