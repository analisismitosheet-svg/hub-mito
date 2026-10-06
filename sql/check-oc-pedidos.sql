-- Diagnóstico: columna "N° OC" de Recepción INDO → detalle del pedido de compra.
--
-- La columna linkea a /compras/pedidos-compra?numero=N, y eso solo funciona si
--   1. el usuario tiene 'pedidos_compra.view' (RLS de la tabla + PermissionRoute), y
--   2. el número existe en public.pedidos_compra.
--
-- Ejecutar con:  node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/check-oc-pedidos.sql --raw
-- (--raw porque el archivo va entero en una sola llamada y usa BEGIN/ROLLBACK).
--
-- El usuario falseado es el admin (56967271-...). Para probar otro, cambiar el UUID en
-- los dos set_config de abajo.
BEGIN;

SELECT set_config('request.jwt.claims',
  '{"sub":"56967271-117d-414a-b1ed-f9ab222f0a34","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '56967271-117d-414a-b1ed-f9ab222f0a34', true);

CREATE TEMP TABLE chk (nombre text, valor text);
GRANT INSERT, SELECT ON chk TO authenticated;

INSERT INTO chk VALUES
  ('usuario falseado', coalesce(auth.uid()::text, 'NULL — los set_config no sirvieron'));
INSERT INTO chk SELECT 'private.es_admin()', private.es_admin()::text;
INSERT INTO chk SELECT 'private.tengo_permiso(pedidos_compra.view)', private.tengo_permiso('pedidos_compra.view')::text;

-- Lo que ve el usuario de verdad (con RLS puesta), no lo que ve el runner.
SET LOCAL ROLE authenticated;
INSERT INTO chk
SELECT 'pedidos_compra visibles para el usuario', count(*)::text FROM public.pedidos_compra;
RESET ROLE;

-- Cuántas OC distintas del Excel resuelven a un pedido. Nótese que las OC pueden venir
-- varias en una celda ("15183/15347/15329"), así que hay que partirlas por '/'.
WITH oc AS (
  SELECT DISTINCT btrim(s.tok) AS oc
  FROM public.recepcion_indo r,
       LATERAL unnest(string_to_array(r.n_oc, '/')) AS s(tok)
  WHERE btrim(s.tok) <> ''
)
INSERT INTO chk
SELECT 'OC distintas en el Excel', count(*)::text FROM oc;

WITH oc AS (
  SELECT DISTINCT btrim(s.tok) AS oc
  FROM public.recepcion_indo r,
       LATERAL unnest(string_to_array(r.n_oc, '/')) AS s(tok)
  WHERE btrim(s.tok) <> ''
)
INSERT INTO chk
SELECT '  ... linkeables (existen en pedidos_compra)',
       count(*)::text FROM oc WHERE EXISTS (SELECT 1 FROM public.pedidos_compra p WHERE p.numero::text = oc.oc);

WITH oc AS (
  SELECT DISTINCT btrim(s.tok) AS oc
  FROM public.recepcion_indo r,
       LATERAL unnest(string_to_array(r.n_oc, '/')) AS s(tok)
  WHERE btrim(s.tok) <> ''
)
INSERT INTO chk
SELECT '  ... no linkeables (el pedido no está en la base)',
       count(*)::text FROM oc WHERE NOT EXISTS (SELECT 1 FROM public.pedidos_compra p WHERE p.numero::text = oc.oc);

WITH oc AS (
  SELECT DISTINCT btrim(s.tok) AS oc
  FROM public.recepcion_indo r,
       LATERAL unnest(string_to_array(r.n_oc, '/')) AS s(tok)
  WHERE btrim(s.tok) <> ''
)
INSERT INTO chk
SELECT '  ... no numéricas (se muestran tal cual)',
       count(*)::text FROM oc WHERE oc.oc !~ '^[0-9]+$';

-- Rango de fechas que cubre la copia: un ingreso anterior a la cobertura tiene un OC que
-- nunca va a linkear, porque el pedido todavía no fue sincronizado (o ya no existe).
INSERT INTO chk
SELECT 'pedidos_compra cubre (fecha)',
       min(fecha)::text || ' .. ' || max(fecha)::text || '  (' || count(*)::text || ' pedidos)'
FROM public.pedidos_compra;

INSERT INTO chk
SELECT 'recepcion_indo cubre (fecha_ingreso)',
       min(fecha_ingreso)::text || ' .. ' || max(fecha_ingreso)::text
FROM public.recepcion_indo;

-- Números repetidos: pasan 3 de las 480 OC (son bajas: 11, 10713, 11901). El deep-link
-- abre el más reciente y lo avisa.
INSERT INTO chk
SELECT 'números de pedido repetidos',
       (SELECT count(*)::text FROM (SELECT numero FROM public.pedidos_compra GROUP BY numero HAVING count(*) > 1) d);

SELECT * FROM chk;

ROLLBACK;
