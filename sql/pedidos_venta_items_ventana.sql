-- ============================================================================
-- Pedidos de venta: en Supabase solo quedan los renglones de los últimos 120 días (28/10/2026).
--
-- Por qué: pedidos_venta_items era 193 MB de los 366 MB de la base del hub (349k renglones
-- desde 2025) y la meta es bajar el hub al compute Micro (Pro <= USD 25). El 74 % era de
-- pedidos de más de 120 días que ya nadie arma.
--
-- Qué cambia:
--   * pedidos_venta.unidades: total de unidades del pedido (sum(round(cantidad)), lo mismo que
--     calculaban las estadísticas). Lo llena el sync con TODOS los renglones que manda el puente,
--     así estadistica_vtd y avance_vtd_rep siguen andando para cualquier período.
--   * El sync (private.pedidos_venta_sync_lote_core) ya no guarda renglones de pedidos con fecha
--     anterior a private.pedidos_venta_items_limite() salvo que tengan un armado activo; si los
--     tenía guardados, se borran solos (la huella cambia).
--   * pedidos_venta_sync_fin, en la copia completa diaria, purga lo que haya quedado viejo.
--   * El detalle de un pedido viejo se lee en vivo de Dragonfish: Puente SQL acción
--     'items_pedido_venta' -> /api/sql/pedido-venta-items -> src/pages/PedidosVenta.tsx.
--   * La búsqueda por artículo (pedidos_venta_por_articulo) solo encuentra pedidos de la ventana.
--
-- Las funciones se editan con reemplazos sobre su definición actual (y fallan si no encuentran
-- el texto), así no se pisa nada que haya cambiado desde los .sql originales. Idempotente.
-- ============================================================================

ALTER TABLE public.pedidos_venta ADD COLUMN IF NOT EXISTS unidades integer;

UPDATE public.pedidos_venta p
   SET unidades = coalesce(s.u, 0)
  FROM (SELECT p2.codigo, (SELECT sum(round(i.cantidad)) FROM public.pedidos_venta_items i WHERE i.codigo = p2.codigo)::integer AS u
          FROM public.pedidos_venta p2) s
 WHERE s.codigo = p.codigo AND p.unidades IS DISTINCT FROM coalesce(s.u, 0);

-- Desde qué fecha se guardan renglones (cambiar acá si hace falta más o menos historia)
CREATE OR REPLACE FUNCTION private.pedidos_venta_items_limite()
RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date - 120 $$;

DO $$
DECLARE d text; n text;
BEGIN
  -- 1) Estadísticas: unidades del pedido desde la cabecera
  d := pg_get_functiondef('public.estadistica_vtd(date,date)'::regprocedure);
  n := replace(d, 'coalesce((SELECT sum(round(i.cantidad)) FROM public.pedidos_venta_items i WHERE i.codigo = p.codigo), 0)', 'coalesce(p.unidades, 0)');
  IF n <> d THEN EXECUTE n; ELSIF position('p.unidades' in d) = 0 THEN RAISE EXCEPTION 'estadistica_vtd: no encontré el texto a reemplazar'; END IF;

  d := pg_get_functiondef('public.avance_vtd_rep(date,date)'::regprocedure);
  n := replace(d, 'coalesce((SELECT sum(round(i.cantidad)) FROM public.pedidos_venta_items i WHERE i.codigo = pv.codigo), 0)', 'coalesce(pv.unidades, 0)');
  IF n <> d THEN EXECUTE n; ELSIF position('pv.unidades' in d) = 0 THEN RAISE EXCEPTION 'avance_vtd_rep: no encontré el texto a reemplazar'; END IF;

  -- 2) Sync: guarda las unidades y descarta los renglones viejos
  d := pg_get_functiondef('private.pedidos_venta_sync_lote_core(bigint,jsonb)'::regprocedure);
  IF position('pedidos_venta_items_limite' in d) = 0 THEN
    n := replace(d, E'   ORDER BY c, l, orden;\n', E'   ORDER BY c, l, orden;\n\n'
      || E'  -- Unidades del pedido con TODOS sus renglones (sql/pedidos_venta_items_ventana.sql)\n'
      || E'  UPDATE public.pedidos_venta p SET unidades = s.u\n'
      || E'    FROM (SELECT trim(f->>''codigo'') AS codigo,\n'
      || E'                 coalesce((SELECT sum(round(i.cantidad)) FROM _pvs_in i WHERE i.codigo = trim(f->>''codigo'')), 0)::integer AS u\n'
      || E'            FROM jsonb_array_elements(p_pedidos) f WHERE coalesce(trim(f->>''codigo''), '''') <> '''') s\n'
      || E'   WHERE p.codigo = s.codigo AND p.unidades IS DISTINCT FROM s.u;\n\n'
      || E'  -- Renglones solo de los últimos 120 días (o con armado activo); los viejos se leen de Dragonfish\n'
      || E'  DELETE FROM _pvs_in i USING public.pedidos_venta p\n'
      || E'   WHERE p.codigo = i.codigo AND p.fecha < private.pedidos_venta_items_limite()\n'
      || E'     AND NOT EXISTS (SELECT 1 FROM public.mayorista_armados a WHERE a.pedido_codigo = p.codigo AND a.estado <> ''hecho'');\n');
    IF n = d THEN RAISE EXCEPTION 'pedidos_venta_sync_lote_core: no encontré el texto a reemplazar'; END IF;
    EXECUTE n;
  END IF;

  -- 3) Copia completa diaria: purga lo que quedó viejo
  d := pg_get_functiondef('public.pedidos_venta_sync_fin(text,bigint,integer,text,boolean)'::regprocedure);
  IF position('pedidos_venta_items_limite' in d) = 0 THEN
    n := replace(d, E'  SELECT count(*) INTO v_pedidos FROM public.pedidos_venta;\n',
         E'  IF p_completa THEN\n'
      || E'    -- Renglones de más de 120 días sin armado activo (sql/pedidos_venta_items_ventana.sql)\n'
      || E'    DELETE FROM public.pedidos_venta_items i USING public.pedidos_venta p\n'
      || E'     WHERE p.codigo = i.codigo AND p.fecha < private.pedidos_venta_items_limite()\n'
      || E'       AND NOT EXISTS (SELECT 1 FROM public.mayorista_armados a WHERE a.pedido_codigo = p.codigo AND a.estado <> ''hecho'');\n'
      || E'  END IF;\n'
      || E'  SELECT count(*) INTO v_pedidos FROM public.pedidos_venta;\n');
    IF n = d THEN RAISE EXCEPTION 'pedidos_venta_sync_fin: no encontré el texto a reemplazar'; END IF;
    EXECUTE n;
  END IF;
END $$;

-- 4) Purga inicial (después: VACUUM FULL public.pedidos_venta_items para devolver el espacio)
DELETE FROM public.pedidos_venta_items i USING public.pedidos_venta p
 WHERE p.codigo = i.codigo AND p.fecha < private.pedidos_venta_items_limite()
   AND NOT EXISTS (SELECT 1 FROM public.mayorista_armados a WHERE a.pedido_codigo = p.codigo AND a.estado <> 'hecho');
