-- ============================================================================
-- El servidor de informes vuelve a poder leer estadistica_vtd (20/10/2026)
--
-- Sintoma: "No se envio: No se pudo armar el informe: No se pudo leer
-- estadistica_vtd (403): 42501 Sin permiso para ver la estadistica".
--
-- Por que pasa: el 14/10 (sql/informes_repo_completa.sql) se le agrego a
-- estadistica_vtd y a avance_vtd_rep la excepcion "auth.role() = 'service_role'",
-- para que api/informe.ts (que entra con la service role key, sin usuario, asi que
-- auth.uid() es NULL) pueda armar el informe de Eficiencia mayorista. Despues se
-- volvio a crear estadistica_vtd y esa excepcion se perdio; avance_vtd_rep la
-- conservo. Desde entonces el envio corta en estadistica_vtd.
--
-- No abre nada nuevo: la service role key ya lee directo las tablas de abajo
-- (mayorista_lotes, mayorista_items, repo_sesiones...). El chequeo para los
-- usuarios (admin o mayorista.estadisticas.view) queda exactamente igual.
--
-- Parchea la funcion que esta viva (no la reescribe) para no pisar los cambios
-- que tenga la base. Idempotente: si ya tiene la excepcion, no hace nada.
-- Ver docs/mapa/Informes por WhatsApp.md.
-- ============================================================================

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.estadistica_vtd(date,date)'::regprocedure);
  IF position('service_role' in d) = 0 THEN
    d := replace(d, 'IF NOT (private.es_admin()', 'IF NOT (auth.role() = ''service_role'' OR private.es_admin()');
    EXECUTE d;
    RAISE NOTICE 'estadistica_vtd: excepcion de service_role agregada';
  ELSE
    RAISE NOTICE 'estadistica_vtd: ya la tenia, no se toco';
  END IF;
END $$;

-- Control: las dos tienen que dar true
SELECT 'estadistica_vtd' AS funcion,
       position('service_role' in pg_get_functiondef('public.estadistica_vtd(date,date)'::regprocedure)) > 0 AS lee_el_servidor
UNION ALL
SELECT 'avance_vtd_rep',
       position('service_role' in pg_get_functiondef('public.avance_vtd_rep(date,date)'::regprocedure)) > 0;
