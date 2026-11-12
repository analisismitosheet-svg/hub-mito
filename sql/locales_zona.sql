-- =====================================================
-- ZONA DE CADA LOCAL (05/11/2026)
--
-- locales.zona: CENTRO | NORTE | SUR | ESTE | OESTE | INTERIOR (null = sin zona,
-- ej. el depósito). La edita el admin en Configuración → Locales (RLS locales_admin).
-- La usan los filtros de Requerimientos (Bandeja: filtro de zona).
--
-- Valores iniciales: calculados con la ubicación del local en tracking_bases respecto de
-- Plaza San Martín (-31.4167, -64.1833): a menos de 1,5 km = CENTRO; más de 25 km =
-- INTERIOR; si no, el eje que más pesa (norte/sur o este/oeste). Rivera y CF Rivera
-- quedan en OESTE (están al noroeste) y Nuevo Centro en OESTE (2 km): revisar.
-- Solo se cargan donde la zona está vacía, así no pisa lo que se corrija a mano.
-- Idempotente.
-- =====================================================
alter table public.locales add column if not exists zona text;
alter table public.locales drop constraint if exists locales_zona_valida;
alter table public.locales add constraint locales_zona_valida
  check (zona is null or zona in ('CENTRO', 'NORTE', 'SUR', 'OESTE', 'CARLOS PAZ', 'RIO CUARTO'));  -- zonas nuevas: sql/arqueos_marcados_y_zonas.sql

update public.locales l set zona = v.zona
  from (values
    ('9DEJULIO', 'CENTRO'), ('CFPO', 'CENTRO'), ('GPAZD', 'CENTRO'), ('MUNOZ', 'CENTRO'),
    ('BUSTOD', 'NORTE'), ('CFD', 'NORTE'), ('LIBERD', 'NORTE'), ('WALMARTD', 'NORTE'), ('MARIANOMAX', 'NORTE'),
    ('ESPINOD', 'SUR'),
    ('RUTA9D2', 'ESTE'), ('CFR9', 'ESTE'),
    ('CFRA', 'OESTE'), ('DINOD', 'OESTE'), ('NVOCED', 'OESTE'), ('RIVERAD', 'OESTE'),
    ('VCPD', 'INTERIOR'), ('CFR4', 'INTERIOR')
  ) as v(codigo, zona)
 where l.codigo = v.codigo and l.zona is null;
