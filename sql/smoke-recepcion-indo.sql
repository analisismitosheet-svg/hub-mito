-- =====================================================
-- Smoke test de Recepción INDO.
--
-- Corre con:  node scripts/supabase-sql.mjs <proyecto> sql/smoke-recepcion-indo.sql --raw
--
-- Va entero en UNA llamada porque necesita BEGIN/ROLLBACK (cada llamada de la Management
-- API es su propia transacción) y porque la API solo devuelve el último resultset: los
-- chequeos se acumulan en una tabla temporal y al final se muestran todos juntos.
--
-- Simula sesión de administrador con set_config para que private.tengo_permiso deje.
-- La parte de escritura inserta 2 filas falsas y termina en ROLLBACK: no toca las
-- recepciones reales ni deja nada.
-- =====================================================

BEGIN;
CREATE TEMP TABLE chk (orden integer, paso text, detalle jsonb) ON COMMIT DROP;

SELECT set_config('request.jwt.claims', '{"sub":"56967271-117d-414a-b1ed-f9ab222f0a34","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '56967271-117d-414a-b1ed-f9ab222f0a34', true);

-- =====================================================================
-- A. Los KPIs contra los datos REALES que se importaron del Excel.
--    Estos numeros son los que.calc scripts/test-recepcion-indo.mjs del Excel.
-- =====================================================================
INSERT INTO chk SELECT 10, 'A1. resumen sobre las filas reales', to_jsonb(r)
  FROM public.recepcion_indo_resumen('') r;

INSERT INTO chk SELECT 11, 'A2. bultos y recepciones sin controlar (contando TODAS)',
  (SELECT to_jsonb(x) FROM (
     SELECT count(*) FILTER (WHERE fecha_controlada IS NULL) AS sin_controlar,
            count(*) FILTER (WHERE fecha_controlada IS NULL AND n_oc ~ '^\s*[0-9]+\s*$' AND btrim(n_oc) <> '') AS con_oc_numerica,
            coalesce(sum(bultos) FILTER (WHERE fecha_controlada IS NULL), 0) AS bultos,
            count(DISTINCT n_oc) FILTER (WHERE fecha_controlada IS NULL AND btrim(n_oc) <> '') AS oc_distintas
     FROM public.recepcion_indo) x);

INSERT INTO chk SELECT 12, 'A3. dias de atraso promedio de las controladas',
  (SELECT to_jsonb(x) FROM (
     SELECT round(avg(dias_atraso)::numeric, 2) AS promedio_dias,
            min(dias_atraso) AS min, max(dias_atraso) AS max
     FROM public.recepcion_indo WHERE fecha_controlada IS NOT NULL) x);

INSERT INTO chk SELECT 13, 'A4. salud de los datos', (SELECT to_jsonb(x) FROM (
     SELECT count(*) AS filas,
            count(DISTINCT clave) AS claves_distintas,
            count(*) FILTER (WHERE dias_atraso <> greatest(0, fecha_controlada - fecha_ingreso)) AS dias_incoherentes,
            count(*) FILTER (WHERE fecha_controlada IS NOT NULL AND fecha_ingreso IS NULL) AS controladas_sin_ingreso,
            count(*) FILTER (WHERE proveedor_codigo IS NOT NULL) AS con_codigo_proveedor
     FROM public.recepcion_indo) x);

INSERT INTO chk SELECT 14, 'A5. despliegue de proveedores', (SELECT to_jsonb(x) FROM (
     SELECT count(*) AS con_codigo,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.recepcion_indo_proveedores p
                                              WHERE p.codigo = r.proveedor_codigo)) AS codigo_huerfano
     FROM public.recepcion_indo r WHERE r.proveedor_codigo IS NOT NULL) x);

INSERT INTO chk SELECT 15, 'A6. depositos y estados presentes', to_jsonb(r)
  FROM public.recepcion_indo_opciones() r;

INSERT INTO chk SELECT 16, 'A7. paginado: total sin cambios, pagina recortada',
  (SELECT to_jsonb(x) FROM (
     SELECT (SELECT max(total) FROM public.recepcion_indo_filas(p_limite => 1)) AS total,
            (SELECT count(*) FROM public.recepcion_indo_filas(p_desde => 0, p_limite => 10)) AS filas_pagina,
            (SELECT count(*) FROM public.recepcion_indo_filas(p_desde => 20, p_limite => 10)) AS filas_pagina_3) x);

INSERT INTO chk SELECT 17, 'A8. filtro que no matchea nada (tiene que dar 0 filas y total 0)',
  (SELECT to_jsonb(x) FROM (
     SELECT (SELECT count(*) FROM public.recepcion_indo_filas(p_proveedor => 'zzz-inexistente', p_limite => 10)) AS filas,
            coalesce((SELECT max(total) FROM public.recepcion_indo_filas(p_proveedor => 'zzz-inexistente', p_limite => 10)), 0) AS total) x);

-- =====================================================================
-- B. Semántica del merge, con 2 filas inventadas (se van en el ROLLBACK).
-- =====================================================================
INSERT INTO chk SELECT 20, 'B1. importar 2 filas nuevas (esperado nuevas=2, actualizadas=0)', to_jsonb(r)
  FROM public.recepcion_indo_importar(p_filas => '[
    {"clave":"SMOKE|A|INDOD|MOZH|R1|2026-01-05|2026-01-03|F1|2026-01-02","nGuia":"SMOKE-A",
     "transporte":"T1","bultos":"10","deposito":"INDOD","proveedor":"ZIMITH","nRemito":"R1",
     "fechaRemito":"2026-01-05","mes":"1","nOc":"15183","ocCargadaDragon":"true","nFactura":"F1",
     "fechaFactura":"2026-01-02","fechaIngreso":"2026-01-03","fechaControlada":"2026-01-10",
     "estado":"Cargado en Flexxus","iva":"consignacion","detalle":"apostromo: O''Brien"},
    {"clave":"SMOKE|B|INDOD|CAV|R2|2026-02-05|2026-02-03|F2|","nGuia":"SMOKE-B",
     "transporte":"T2","bultos":"7","deposito":"INDOD","proveedor":"Carlos Antonio Vilariño",
     "nRemito":"R2","fechaRemito":"2026-02-05","mes":"2","nOc":"15183/15347","ocCargadaDragon":"false",
     "nFactura":"F2","fechaIngreso":"2026-02-03","estado":"En deposito","iva":"1234.56"}
  ]'::jsonb) r;

INSERT INTO chk SELECT 21, 'B2. tipos sucios: iva textual -> NULL, atraso derivado, apostrofe intacto',
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.n_guia) FROM (
     SELECT n_guia, bultos, iva::text AS iva, detalle, fecha_controlada, dias_atraso,
            oc_cargada_dragon, n_oc, proveedor
     FROM public.recepcion_indo WHERE n_guia LIKE 'SMOKE-%') x);

INSERT INTO chk SELECT 22, 'B3. reimportar las mismas 2 (esperado nuevas=0, actualizadas=2, sin duplicar)', to_jsonb(r)
  FROM public.recepcion_indo_importar(p_filas => '[
    {"clave":"SMOKE|A|INDOD|MOZH|R1|2026-01-05|2026-01-03|F1|2026-01-02","nGuia":"SMOKE-A","bultos":"10",
     "deposito":"INDOD","proveedor":"ZIMITH","fechaIngreso":"2026-01-03","estado":"Cargado en Flexxus"},
    {"clave":"SMOKE|B|INDOD|CAV|R2|2026-02-05|2026-02-03|F2|","nGuia":"SMOKE-B","bultos":"7",
     "deposito":"INDOD","proveedor":"Carlos Antonio Vilariño","fechaIngreso":"2026-02-03","estado":"En deposito"}
  ]'::jsonb) r;

INSERT INTO chk SELECT 23, 'B4. el Excel sin fechaControlada NO borra la ya cargada (2026-01-10)',
  (SELECT to_jsonb(x) FROM (
     SELECT fecha_controlada, dias_atraso FROM public.recepcion_indo WHERE n_guia = 'SMOKE-A') x);

INSERT INTO chk SELECT 24, 'B5. filtro pendientes sobre las filas de prueba',
  (SELECT to_jsonb(x) FROM (
     SELECT count(*) AS smoke_en_la_tabla FROM public.recepcion_indo WHERE n_guia LIKE 'SMOKE-%') x);

SELECT orden, paso, detalle FROM chk ORDER BY orden;

ROLLBACK;
