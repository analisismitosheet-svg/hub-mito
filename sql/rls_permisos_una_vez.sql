-- Rendimiento de RLS (28/10/2026): envuelve en (SELECT ...) las llamadas a private.* con argumentos
-- constantes, así Postgres las evalúa UNA vez por consulta y no una vez por fila.
-- Ej.: mayorista_armados_items (15k filas) pasaba private.tengo_permiso() por cada fila (0,6 s por consulta,
-- 7.000 consultas en 2 días). Mismo arreglo que se le hizo al tracking.
-- No cambia quién ve qué: las funciones solo dependen del usuario logueado.
-- Las llamadas con columnas de la fila como argumento (ej. private.contador_puede_ver(local)) no se tocan.
-- Idempotente: se puede volver a correr (solo toca lo que todavía no está envuelto).
DO $$
DECLARE
  r record;
  q2 text;
  w2 text;
  patron constant text := '(?<!select )(private\.\w+\((''[^'']*''::text)?\))';
BEGIN
  FOR r IN SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname = 'public' LOOP
    q2 := regexp_replace(r.qual, patron, '(SELECT \1)', 'gi');
    w2 := regexp_replace(r.with_check, patron, '(SELECT \1)', 'gi');
    -- «= ANY ((SELECT f()))» Postgres lo toma como subconsulta (text = text[]): el cast lo vuelve un valor
    q2 := replace(q2, '= ANY ((SELECT private.mis_origenes()))', '= ANY ((SELECT private.mis_origenes())::text[])');
    w2 := replace(w2, '= ANY ((SELECT private.mis_origenes()))', '= ANY ((SELECT private.mis_origenes())::text[])');
    IF q2 IS DISTINCT FROM r.qual OR w2 IS DISTINCT FROM r.with_check THEN
      EXECUTE format('ALTER POLICY %I ON public.%I%s%s', r.policyname, r.tablename,
        CASE WHEN q2 IS DISTINCT FROM r.qual THEN ' USING (' || q2 || ')' ELSE '' END,
        CASE WHEN w2 IS DISTINCT FROM r.with_check THEN ' WITH CHECK (' || w2 || ')' ELSE '' END);
    END IF;
  END LOOP;
END $$;
