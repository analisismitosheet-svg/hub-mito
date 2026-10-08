-- ======================================================================
-- Prueba de humo de las funciones de ARMADO (sql/mayorista_armados.sql).
--
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp scripts/test-armados.sql --raw
--
-- Corre en UNA transacción y devuelve los pasos como último resultset.
-- Todo lo que crea usa obs = 'PRUEBA-HUB-ARMADOS' y se borra con:
--   DELETE FROM public.mayorista_armados WHERE obs = 'PRUEBA-HUB-ARMADOS';
-- (los renglones caen por ON DELETE CASCADE).
-- ======================================================================
BEGIN;

-- Idempotente: si quedó una corrida anterior, se borra antes de empezar
DELETE FROM public.mayorista_armados WHERE obs = 'PRUEBA-HUB-ARMADOS';

-- Los roles se fingen con el JWT de dos usuarios reales:
--   admin 56967271… (rol administrador) y legajo 4004 (rol empleado, piso)
SELECT set_config('request.jwt.claims',
  '{"sub":"56967271-117d-414a-b1ed-f9ab222f0a34","role":"authenticated"}', false);

CREATE TEMP TABLE _res (paso text, detalle text);
GRANT ALL ON TABLE pg_temp._res TO authenticated;

-- ------------------------------------------------------------------
-- 1) El mayorista pide el armado (pedido N° 10066, 2 renglones)
-- ------------------------------------------------------------------
DO $$
DECLARE
  v_cod text := '1768378411388B14ADB1B73A16916057519101';
  v_id  uuid;
  v_n   integer;
  v_res integer;
BEGIN
  v_n := public.pedir_armado(ARRAY[v_cod], 'urgente', 'PRUEBA-HUB-ARMADOS');
  INSERT INTO pg_temp._res VALUES ('01 pedir_armado', 'creados=' || v_n::text || ' (esperado 1)');

  SELECT id INTO v_id FROM public.mayorista_armados
   WHERE pedido_codigo = v_cod AND obs = 'PRUEBA-HUB-ARMADOS' AND estado = 'pendiente';
  SELECT count(*) INTO v_res FROM public.mayorista_armados_items WHERE armado_id = v_id;
  INSERT INTO pg_temp._res VALUES ('02 armado', coalesce(v_id::text, 'SIN ID') || ' · renglones=' || v_res::text);

  v_n := public.pedir_armado(ARRAY[v_cod], 'normal', 'PRUEBA-HUB-ARMADOS');
  SELECT count(*) INTO v_res FROM public.mayorista_armados WHERE pedido_codigo = v_cod;
  INSERT INTO pg_temp._res VALUES ('03 duplicado', 'creados=' || v_n::text || ' (esperado 0) · filas=' || v_res::text || ' (esperado 1)');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._res VALUES ('FALLO 01-03', SQLERRM);
END $$;

-- ------------------------------------------------------------------
-- 2) El legajo del piso: acepta, escanea, deshace, tilda y finaliza
-- ------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"33adeafe-1552-4dc5-9527-a9631adce81d","role":"authenticated"}', false);

DO $$
DECLARE
  v_cod   text := '1768378411388B14ADB1B73A16916057519101';
  v_id    uuid;
  v_ok    boolean;
  v_art   text;
  v_linea integer;
  v_esc   integer;
  v_cant  integer;
  v_fal   integer;
BEGIN
  SELECT id INTO v_id FROM public.mayorista_armados
   WHERE pedido_codigo = v_cod AND obs = 'PRUEBA-HUB-ARMADOS';
  IF v_id IS NULL THEN RAISE EXCEPTION 'no se creó el armado de prueba'; END IF;

  v_ok := public.armado_aceptar(v_id, '4004', 'Legajo de prueba');
  INSERT INTO pg_temp._res VALUES ('04 aceptar', v_ok::text || ' (esperado true)');
  INSERT INTO pg_temp._res SELECT '05 estado', estado || ' · legajo=' || coalesce(aceptado_legajo, '-')
    FROM public.mayorista_armados WHERE id = v_id;

  -- Escaneo del primer artículo pendiente
  SELECT articulo INTO v_art FROM public.mayorista_armados_items
   WHERE armado_id = v_id AND estado <> 'faltante' AND escaneadas < cantidad
   ORDER BY linea LIMIT 1;
  IF v_art IS NULL THEN
    INSERT INTO pg_temp._res VALUES ('06 escanear', 'SIN ARTÍCULO PENDIENTE');
  ELSE
    SELECT s.item_escaneadas, s.item_cantidad INTO v_esc, v_cant
      FROM public.armado_escanear(v_id, v_art) s;
    INSERT INTO pg_temp._res VALUES ('06 escanear', v_art || ' -> ' || v_esc || '/' || v_cant);
  END IF;

  -- Deshacer (el "↺ Deshacer" del piso)
  BEGIN
    SELECT linea INTO v_linea FROM public.mayorista_armados_items
     WHERE armado_id = v_id AND escaneadas > 0 ORDER BY linea LIMIT 1;
    IF v_linea IS NULL THEN
      INSERT INTO pg_temp._res VALUES ('07 deshacer', 'ninguna línea tenía escaneos');
    ELSE
      SELECT d.item_escaneadas INTO v_esc FROM public.armado_deshacer(v_id, v_linea) d;
      INSERT INTO pg_temp._res VALUES ('07 deshacer', 'linea ' || v_linea || ' -> ' || coalesce(v_esc::text, 'SIN FILA'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._res VALUES ('07 deshacer', SQLERRM);
  END;

  -- Tilde manual de la primera línea que quede pendiente
  SELECT linea INTO v_linea FROM public.mayorista_armados_items
   WHERE armado_id = v_id AND estado = 'pendiente' ORDER BY linea LIMIT 1;
  IF v_linea IS NOT NULL THEN
    SELECT m.item_escaneadas INTO v_esc FROM public.armado_marcar_item(v_id, v_linea) m;
    INSERT INTO pg_temp._res VALUES ('08 tilde manual', 'linea ' || v_linea || ' -> ' || coalesce(v_esc::text, 'SIN FILA'));
  ELSE
    INSERT INTO pg_temp._res VALUES ('08 tilde manual', 'no quedaban líneas pendientes');
  END IF;

  -- Finalizar (lo que falte pasa a faltante)
  v_fal := public.armado_finalizar(v_id);
  INSERT INTO pg_temp._res SELECT '09 finalizar', 'faltantes=' || v_fal::text || ' · estado=' || estado ||
    ' · hecho_at=' || (hecho_at IS NOT NULL)::text
    FROM public.mayorista_armados WHERE id = v_id;

  -- Escanear un armado ya cerrado tiene que fallar
  BEGIN
    PERFORM * FROM public.armado_escanear(v_id, coalesce(v_art, 'X'));
    INSERT INTO pg_temp._res VALUES ('10 escanear cerrado', 'NO FALLÓ (mal)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._res VALUES ('10 escanear cerrado', SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._res VALUES ('FALLO 04-10', SQLERRM);
END $$;

-- ------------------------------------------------------------------
-- 3) La carrera: dos legajos tocan Acepto a la vez (gana el primero)
-- ------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"56967271-117d-414a-b1ed-f9ab222f0a34","role":"authenticated"}', false);

DO $$
DECLARE
  v_cod text := '1CF4AD36F14141145AD1B45512536975982121';
  v_n   integer;
BEGIN
  v_n := public.pedir_armado(ARRAY[v_cod], 'normal', 'PRUEBA-HUB-ARMADOS');
  INSERT INTO pg_temp._res VALUES ('11 pedir 2do', 'creados=' || v_n::text || ' (esperado 1)');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._res VALUES ('FALLO 11', SQLERRM);
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"33adeafe-1552-4dc5-9527-a9631adce81d","role":"authenticated"}', false);

DO $$
DECLARE
  v_id uuid;
  v_ok boolean;
BEGIN
  SELECT id INTO v_id FROM public.mayorista_armados
   WHERE pedido_codigo = '1CF4AD36F14141145AD1B45512536975982121' AND obs = 'PRUEBA-HUB-ARMADOS';
  v_ok := public.armado_aceptar(v_id, '4004', 'Legajo de prueba');
  INSERT INTO pg_temp._res VALUES ('12 acepta 4004', v_ok::text || ' (esperado true)');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._res VALUES ('FALLO 12', SQLERRM);
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"30ac8cbd-cabe-4b14-97d9-0c02786bb5d5","role":"authenticated"}', false);

DO $$
DECLARE
  v_id uuid;
  v_ok boolean;
  v_art text;
BEGIN
  SELECT id INTO v_id FROM public.mayorista_armados
   WHERE pedido_codigo = '1CF4AD36F14141145AD1B45512536975982121' AND obs = 'PRUEBA-HUB-ARMADOS';

  v_ok := public.armado_aceptar(v_id, '824', 'Otro legajo');
  INSERT INTO pg_temp._res VALUES ('13 acepta 824', v_ok::text || ' (esperado false: ya lo tomó 4004)');

  BEGIN
    SELECT articulo INTO v_art FROM public.mayorista_armados_items
     WHERE armado_id = v_id AND estado <> 'faltante' AND escaneadas < cantidad ORDER BY linea LIMIT 1;
    PERFORM * FROM public.armado_escanear(v_id, coalesce(v_art, 'X'));
    INSERT INTO pg_temp._res VALUES ('14 escanea 824', 'NO FALLÓ (mal: es de 4004)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp._res VALUES ('14 escanea 824', SQLERRM);
  END;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO pg_temp._res VALUES ('FALLO 13-14', SQLERRM);
END $$;

-- La prueba no deja nada: borra lo que creó (los renglones caen por cascade)
DELETE FROM public.mayorista_armados WHERE obs = 'PRUEBA-HUB-ARMADOS';

SELECT * FROM pg_temp._res ORDER BY paso;

COMMIT;
