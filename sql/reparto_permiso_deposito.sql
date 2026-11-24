-- Reparto manual para el rol Depósito (2026-11-24, sigue a sql/reparto_permiso_mayorista_cargar.sql)
--
-- Mismo permiso que Mayorista: transferencias.reparto (ver y cargar lote y pedidos en Dragon,
-- sin el resto de Transferencias). La tarjeta aparece también en el área Depósito
-- (areaIds de 'mayorista-reparto' en src/config/areas.ts).

insert into public.rol_permisos (rol, permiso_clave)
values ('deposito', 'transferencias.reparto')
on conflict do nothing;
