-- Administración > Tablero locales — permiso propio (27/11/2026)
--
-- La pantalla no escribe nada: lee en vivo las hojas Caja y Errores de caja de cada
-- local desde su base Dragonfish, por el Puente SQL (solo lectura; ver
-- puente-sql/tablero-locales.js). No se le asigna a ningún rol: queda para los
-- administradores (private.es_admin pasa todos los permisos) y para quien se lo den
-- en Roles y permisos, porque muestra la caja y los arqueos de todos los locales.

insert into public.permisos (clave, modulo, accion, label, orden)
values ('tablero_locales.view', 'tablero_locales', 'view', 'Ver Tablero locales · caja y errores de caja de cada local', 1506)
on conflict (clave) do update set label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;
