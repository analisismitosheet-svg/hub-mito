-- Contador de clientes: "canceling statement due to statement timeout" en "Este mes" con todos los locales (26/11/2026).
-- Causa: la política de contador_visitas llamaba private.contador_puede_ver(local) por cada fila (hasta 4
-- consultas de permisos por fila) y contador_resumen recorría el CTE v cinco veces.
-- Arreglo: los permisos se calculan una vez por consulta (subselects) y v se materializa una sola vez.
-- No cambia quién ve qué. Aplicado en hub-mito. Mes completo: ~40 ms.

DROP POLICY IF EXISTS contador_visitas_ver ON public.contador_visitas;
CREATE POLICY contador_visitas_ver ON public.contador_visitas FOR SELECT TO authenticated
USING (
  (SELECT private.tiene_permiso('contador.view') OR private.tiene_permiso('ia_camaras.view') OR private.tiene_permiso('conversion.view'))
  AND (
    (SELECT private.tiene_permiso('contador.ver_todo'))
    OR upper(local) = (SELECT upper(coalesce(private.mi_local(), '')))
  )
);

-- contador_resumen: el CTE v pasa a MATERIALIZED (se lee la tabla una sola vez)
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.contador_resumen(date,date,text[])'::regprocedure);
  IF position('WITH v AS MATERIALIZED (' in d) = 0 THEN
    EXECUTE replace(d, 'WITH v AS (', 'WITH v AS MATERIALIZED (');
  END IF;
END $$;
