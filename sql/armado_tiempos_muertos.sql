-- ============================================================================
-- Tiempo muerto entre tareas (fin de una → inicio de la siguiente)
--
-- Aplicado en Supabase (migración armado_tiempos_muertos). Idempotente.
--
-- El mayorista quiere medir el hueco que queda entre que un legajo termina un
-- pedido y arranca el siguiente. Para eso hace falta saber CUÁNDO arrancó cada
-- armado: mayorista_armados ya tenía aceptado_at y hecho_at, y ahora suma
-- iniciado_at (la primera vez que se toca Iniciar/Reanudar; sql/una_tarea_a_la_vez.sql).
--
-- estadistica_tiempos_muertos(desde, hasta): por empleado, cuántos "cortes" hubo
-- (veces que terminó una tarea y tardó en arrancar la próxima), el tiempo muerto
-- total, el promedio y el máximo. Cuenta armados Y repos, y solo huecos del mismo
-- día (hora Argentina): no suma la noche. Si el hueco queda abierto (nunca arrancó
-- otra tarea) no se cuenta: no se puede saber si siguió trabajando o se fue.
-- ============================================================================

ALTER TABLE public.mayorista_armados
  ADD COLUMN IF NOT EXISTS iniciado_at timestamptz;

-- Los armados viejos no tienen el arranque guardado: se usa aceptado_at como
-- aproximación (solo alimenta la estadística de tiempo muerto).
UPDATE public.mayorista_armados
   SET iniciado_at = aceptado_at
 WHERE iniciado_at IS NULL AND aceptado_at IS NOT NULL;

-- ---- Cronómetro del armado (idéntico a una_tarea_a_la_vez.sql + iniciado_at) ----
CREATE OR REPLACE FUNCTION public.armado_iniciar(p_id uuid)
RETURNS TABLE(estado text, segundos integer, desde timestamptz, ahora timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_num integer; v_cod text;
BEGIN
  SELECT a.pedido_numero, a.pedido_codigo INTO v_num, v_cod FROM public.mayorista_armados a
   WHERE a.id = p_id AND a.estado = 'aceptado' AND a.aceptado_por = auth.uid() FOR UPDATE;
  IF v_cod IS NULL THEN RAISE EXCEPTION 'Ese armado no está en curso con vos' USING ERRCODE = 'P0002'; END IF;

  PERFORM private.pausar_lo_demas(auth.uid(), p_id, NULL, 'Pasó al pedido N° ' || coalesce(v_num::text, v_cod));

  UPDATE public.piso_pausas SET hasta = now() WHERE armado_id = p_id AND hasta IS NULL;
  UPDATE public.mayorista_armados
     SET crono_estado = 'en_curso',
         iniciado_at = coalesce(iniciado_at, now()),
         crono_desde = coalesce(CASE WHEN crono_estado = 'en_curso' THEN crono_desde END, now())
   WHERE id = p_id;
  RETURN QUERY SELECT * FROM public.armado_crono(p_id);
END;
$$;

-- ---- Estadística: tiempo muerto entre tareas ----
CREATE OR REPLACE FUNCTION public.estadistica_tiempos_muertos(p_desde date, p_hasta date)
RETURNS TABLE(usuario_id uuid, legajo text, nombre text, cortes integer, muerto integer, promedio integer, maximo integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('mayorista.estadisticas.view')) THEN
    RAISE EXCEPTION 'Sin permiso para ver la estadística' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH eventos AS (
    -- Armados: arranque (Iniciar) y fin (Finalizar o completado solo)
    SELECT a.aceptado_por AS usuario_id, coalesce(a.iniciado_at, a.aceptado_at) AS at, 'inicio'::text AS tipo
      FROM public.mayorista_armados a
     WHERE a.aceptado_por IS NOT NULL AND coalesce(a.iniciado_at, a.aceptado_at) IS NOT NULL
    UNION ALL
    SELECT a.aceptado_por, a.hecho_at, 'fin'
      FROM public.mayorista_armados a
     WHERE a.aceptado_por IS NOT NULL AND a.hecho_at IS NOT NULL
    UNION ALL
    -- Repos: inicio y fin de cada sesión
    SELECT s.usuario_id, s.iniciada_at, 'inicio'
      FROM public.repo_sesiones s
     WHERE s.iniciada_at IS NOT NULL
    UNION ALL
    SELECT s.usuario_id, s.finalizada_at, 'fin'
      FROM public.repo_sesiones s
     WHERE s.finalizada_at IS NOT NULL
  ),
  con_previo AS (
    SELECT e.usuario_id, e.at, e.tipo,
           lag(e.tipo) OVER w AS previo_tipo,
           lag(e.at)   OVER w AS previo_at
      FROM eventos e
    WINDOW w AS (PARTITION BY e.usuario_id ORDER BY e.at, CASE WHEN e.tipo = 'fin' THEN 0 ELSE 1 END)
  ),
  huecos AS (
    SELECT c.usuario_id, c.at, (c.at - c.previo_at) AS espera
      FROM con_previo c
     WHERE c.tipo = 'inicio'
       AND c.previo_tipo = 'fin'
       AND c.previo_at IS NOT NULL
       AND c.at > c.previo_at
       -- Solo el mismo día (hora Argentina): no se cuenta la noche
       AND (c.previo_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
           = (c.at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
       AND (c.at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN p_desde AND p_hasta
  )
  SELECT h.usuario_id,
         u.legajo::text,
         coalesce(nullif(btrim(u.nombre), ''), u.email)::text,
         count(*)::integer,
         coalesce(sum(extract(epoch FROM h.espera)), 0)::bigint::integer,
         coalesce(round(avg(extract(epoch FROM h.espera))), 0)::integer,
         coalesce(round(max(extract(epoch FROM h.espera))), 0)::integer
    FROM huecos h
    LEFT JOIN public.usuarios u ON u.id = h.usuario_id
   GROUP BY 1, 2, 3
   ORDER BY 5 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.armado_iniciar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estadistica_tiempos_muertos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armado_iniciar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estadistica_tiempos_muertos(date, date) TO authenticated;
