-- ============================================================================
-- Estadísticas de Transferencias: "canceling statement due to statement timeout"
--
-- Ejecutar en Supabase SQL Editor. Todo el bloque, en orden. Idempotente.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ PASA
-- ---------------------------------------------------------------------------
-- La página pide todo el tablero a la función `estadisticas_transferencias`.
-- Esa función es SECURITY INVOKER, así que cada fila de `transfer_items` que
-- agrega pasa antes por las policies de RLS:
--
--     USING (private.es_admin() OR private.tiene_permiso('transferencias.import')
--            OR private.tiene_permiso('transferencias.ver_todo'))
--     USING (private.tiene_permiso('transferencias.view')
--            AND upper(coalesce(origen,'')) = upper(coalesce(private.mi_local(),'')))
--
-- Esas tres funciones son STABLE (leen de tablas), así que Postgres NO las puede
-- resolver una sola vez: las evalúa por fila. Con las agregaciones de la
-- función eso son cientos de miles de llamadas y el statement se pasa del
-- `statement_timeout`.
--
-- Medido desde la anon key: un simple `select hecho_at order by hecho_at desc
-- limit 1` sobre `transfer_items` tarda >3 s y falla, INCLUSO con cero filas
-- visibles. O sea que no es que falte un índice: es el costo de RLS por fila.
--
-- Esto ya se sabe en este repo: `sql/listar_transfer_items.sql` tiene el
-- comentario "FIX CAUSA RAÍZ (v2): canceling statement due to statement timeout"
-- y se resuelve poniendo esa RPC en SECURITY DEFINER.
--
-- ---------------------------------------------------------------------------
-- QUÉ HACE ESTE SCRIPT
-- ---------------------------------------------------------------------------
-- 1. Diagnóstico: dice cuántos ítems ve tu perfil y cuánto tarda la función.
-- 2. Índices que faltan para las agregaciones (idempotente).
-- 3. Le da a la función un `statement_timeout` propio, más alto que el del rol.
--    NO se cambia la seguridad: seguir siendo INVOKER es lo que hace que un
--    local vea solo lo suyo. El timeout más alto es para que la consulta
--    termine, no para cambiar quién ve qué.
--
-- Ojo: esto destraba la pantalla, pero el arreglo de fondo es que la función
-- valide los permisos una vez al principio y lea con el rol definitor
-- (SECURITY DEFINER, como `listar_transfer_items`). Eso hay que hacerlo
-- reescribiendo el cuerpo de la función, y hace falta tenerla a mano.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DIAGNÓSTICO
--    No se asume la firma: se busca en pg_proc y se arma la llamada con tantos
--    NULL como parámetros tenga, así este bloque no puede fallar por aridad.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_sig       text;
  v_prosecdef boolean;
  v_nargs     int;
  v_total     bigint;
  v_mislocal  text;
  v_perm      boolean;
  v_timeout   text;
  v_t0        timestamptz;
  v_ms        bigint;
  v_llamada   text;
BEGIN
  RAISE NOTICE '======================== DIAGNÓSTICO ========================';

  SELECT p.oid::regprocedure::text, p.prosecdef, p.pronargs
    INTO v_sig, v_prosecdef, v_nargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'estadisticas_transferencias'
   ORDER BY p.pronargs
   LIMIT 1;

  IF v_sig IS NULL THEN
    RAISE NOTICE 'ATENCIÓN: no se encontró public.estadisticas_transferencias';
    RETURN;
  END IF;

  RAISE NOTICE 'firma                    = %', v_sig;
  RAISE NOTICE 'parámetros               = %', v_nargs;
  RAISE NOTICE 'SECURITY DEFINER        = %   <- false = paga RLS fila por fila',
    coalesce(v_prosecdef, false);
  RAISE NOTICE 'statement_timeout (rol)  = %', current_setting('statement_timeout');

  BEGIN
    SELECT private.mi_local() INTO v_mislocal;
    RAISE NOTICE 'mi_local()               = %', coalesce(v_mislocal, '(vacío)');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'mi_local()               = no se pudo leer (%s)', SQLERRM;
  END;

  BEGIN
    SELECT private.tiene_permiso('transferencias.ver_todo') INTO v_perm;
    RAISE NOTICE 'tiene ver_todo           = %', coalesce(v_perm, false);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'tiene ver_todo           = no se pudo leer (%s)', SQLERRM;
  END;

  -- Cuánto ve realmente este perfil (si esto revienta, ya es diagnóstico)
  BEGIN
    SELECT count(*) INTO v_total FROM public.transfer_items;
    RAISE NOTICE 'ítems visibles (perfil)  = %', v_total;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ítems visibles (perfil)  = LA CONSULTA REVienta: %s', SQLERRM;
  END;

  -- Cronometrar la función sin filtro (el caso más pesado). NULL en todos los
  -- parámetros = "todo", que es lo que más filas agrega.
  v_llamada := 'SELECT public.estadisticas_transferencias('
               || repeat('NULL, ', greatest(v_nargs - 1, 0)) || 'NULL)';
  BEGIN
    v_t0 := clock_timestamp();
    EXECUTE v_llamada;
    v_ms := (extract(epoch FROM (clock_timestamp() - v_t0)) * 1000)::bigint;
    RAISE NOTICE 'función sin filtro        = % ms', v_ms;
    IF v_ms > 2000 THEN
      RAISE NOTICE '  -> sigue pagando RLS por fila: el arreglo de fondo es pasarla a SECURITY DEFINER';
    END IF;
  EXCEPTION WHEN query_canceled THEN
    RAISE NOTICE 'función sin filtro        = REVienta por TIMEOUT (o sea: confirmado)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'función sin filtro        = no se pudo cronometrar: %s', SQLERRM;
  END;

  RAISE NOTICE '=============================================================';
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. ÍNDICES
--    Los que hacen falta para las agregaciones por fecha/estado/local. Con RLS
--    por fila no se usan del todo, pero sirven cuando la función pase a
--    SECURITY DEFINER (que es cuando van a importar de verdad).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS transfer_items_created_at_idx
  ON public.transfer_items (created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS transfer_items_hecho_at_idx
  ON public.transfer_items (hecho_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS transfer_items_estado_idx
  ON public.transfer_items (estado);
CREATE INDEX IF NOT EXISTS transfer_items_lote_id_orden_idx
  ON public.transfer_items (lote_id, orden);
CREATE INDEX IF NOT EXISTS transfer_lotes_fecha_idx
  ON public.transfer_lotes (fecha DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 3. TIMEOUT PROPIO PARA LA FUNCIÓN
--    `statement_timeout` a nivel función pisa al del rol, solo para esta llamada.
--    Se resuelve la firma sola (no hace falta saberla) y tolera que haya más
--    de una sobrecarga. NO se toca SECURITY: sigue siendo INVOKER.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_hay boolean := false;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'estadisticas_transferencias'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET statement_timeout = %L', r.sig, '60s');
    RAISE NOTICE 'statement_timeout = 60s en %s', r.sig;
    v_hay := true;
  END LOOP;
  IF NOT v_hay THEN
    RAISE NOTICE 'No se encontró la función: no se cambió nada';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. ÍNDICES PARA LAS policies (parte de la causa raíz, no del síntoma)
--    Las policies comparan `upper(origen)`; sin índice b-tree sobre la
--    expresión, cada fila es un seq scan dentro del seq scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS transfer_items_origen_upper_idx
  ON public.transfer_items (upper(origen));
CREATE INDEX IF NOT EXISTS transfer_items_destino_upper_idx
  ON public.transfer_items (upper(destino));

-- Para ver el tamaño real de las tablas y cuánto RLS está costando:
--   SELECT relname, n_live_tup, n_dead_tup
--     FROM pg_stat_user_tables WHERE relname LIKE 'transfer%';
