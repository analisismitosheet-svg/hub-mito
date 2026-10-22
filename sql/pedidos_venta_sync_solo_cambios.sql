-- ============================================================================
-- Sync de pedidos de venta: sólo se reescriben los renglones de los pedidos que
-- CAMBIARON. Aplicar DESPUÉS de pedidos_venta.sql y pedidos_venta_motivo.sql.
--
-- Problema (22/10/2026): "pedidos_venta_sync_lote: HTTP 500 canceling statement
-- due to statement timeout". El puente llama como `anon` (statement_timeout 3 s)
-- y cada lote borraba y volvía a insertar TODOS los renglones de sus pedidos
-- (hasta 2000), aunque no hubieran cambiado. pedidos_venta_items tiene dos
-- índices trigram (artículo y descripción) y ese borrar + insertar llegaba a
-- ~3 s: promedio 754 ms, picos de 2979 ms.
--
-- Fix: por cada pedido del lote se compara una huella (md5) de sus renglones
-- entrantes contra la de los guardados, y sólo se borran/insertan los de los
-- pedidos distintos. De paso, un pedido sin cambios ya no se renumera.
-- El puente además baja ITEMS_POR_LOTE de 2000 a 800.
--
-- Aplicado en Supabase (migración pedidos_venta_sync_solo_cambios). Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.pedidos_venta_sync_lote_core(p_gen bigint, p_pedidos jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.pedidos_venta AS p
    (codigo, motivo, motivo_nombre, numero, descripcion, fecha, fecha_alta, cliente, cliente_nombre, vendedor, observacion,
     subtotal, impuestos, total, anulado, usuario, base, sync_gen, actualizado_at)
  SELECT trim(f->>'codigo'), nullif(trim(f->>'motivo'), ''), nullif(trim(f->>'motivo_nombre'), ''), (f->>'numero')::integer, nullif(trim(f->>'descripcion'), ''),
         (f->>'fecha')::date, (f->>'fecha_alta')::timestamptz,
         nullif(trim(f->>'cliente'), ''), nullif(trim(f->>'cliente_nombre'), ''),
         nullif(trim(f->>'vendedor'), ''), nullif(trim(f->>'observacion'), ''),
         (f->>'subtotal')::numeric, (f->>'impuestos')::numeric, (f->>'total')::numeric,
         coalesce((f->>'anulado')::boolean, false),
         nullif(trim(f->>'usuario'), ''), nullif(trim(f->>'base'), ''), p_gen, now()
  FROM jsonb_array_elements(p_pedidos) f
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo) DO UPDATE
    SET motivo = excluded.motivo, motivo_nombre = excluded.motivo_nombre, numero = excluded.numero, descripcion = excluded.descripcion, fecha = excluded.fecha,
        fecha_alta = excluded.fecha_alta, cliente = excluded.cliente, cliente_nombre = excluded.cliente_nombre,
        vendedor = excluded.vendedor, observacion = excluded.observacion, subtotal = excluded.subtotal,
        impuestos = excluded.impuestos, total = excluded.total, anulado = excluded.anulado,
        usuario = excluded.usuario, base = excluded.base, sync_gen = excluded.sync_gen,
        actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Renglones entrantes ya normalizados como se guardan (si una línea viene repetida
  -- gana la primera, igual que el ON CONFLICT DO NOTHING de antes).
  CREATE TEMP TABLE IF NOT EXISTS _pvs_in (
    codigo text, linea integer, articulo text, descripcion text, color text, color_nombre text, talle text,
    cantidad numeric, precio numeric, neto numeric, iva numeric, bruto numeric
  ) ON COMMIT DROP;
  TRUNCATE _pvs_in;
  INSERT INTO _pvs_in
  SELECT DISTINCT ON (c, l) c, l, art, des, col, coln, tal, cant, pre, net, iv, bru
    FROM (
      SELECT trim(f->>'codigo') AS c, (it->>'linea')::integer AS l,
             nullif(upper(regexp_replace(coalesce(it->>'articulo', ''), '\s', '', 'g')), '') AS art,
             nullif(trim(it->>'descripcion'), '') AS des,
             nullif(trim(it->>'color'), '') AS col, nullif(trim(it->>'color_nombre'), '') AS coln, nullif(trim(it->>'talle'), '') AS tal,
             (it->>'cantidad')::numeric AS cant, (it->>'precio')::numeric AS pre, (it->>'neto')::numeric AS net,
             (it->>'iva')::numeric AS iv, (it->>'bruto')::numeric AS bru,
             fo.n * 100000 + io.n AS orden
        FROM jsonb_array_elements(p_pedidos) WITH ORDINALITY fo(f, n),
             jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) WITH ORDINALITY io(it, n)
       WHERE coalesce(trim(f->>'codigo'), '') <> ''
    ) x
   ORDER BY c, l, orden;

  -- Pedidos cuyos renglones cambiaron (incluye los que ahora vienen sin renglones)
  CREATE TEMP TABLE IF NOT EXISTS _pvs_cambiados (codigo text PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _pvs_cambiados;
  INSERT INTO _pvs_cambiados
  WITH cods AS (
    SELECT DISTINCT trim(f->>'codigo') AS codigo FROM jsonb_array_elements(p_pedidos) f
     WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ), h_in AS (
    SELECT i.codigo, md5(string_agg(ROW(i.linea, i.articulo, i.descripcion, i.color, i.color_nombre, i.talle,
                                        i.cantidad, i.precio, i.neto, i.iva, i.bruto)::text, '|' ORDER BY i.linea)) AS h
      FROM _pvs_in i GROUP BY 1
  ), h_db AS (
    SELECT i.codigo, md5(string_agg(ROW(i.linea, i.articulo, i.descripcion, i.color, i.color_nombre, i.talle,
                                        i.cantidad, i.precio, i.neto, i.iva, i.bruto)::text, '|' ORDER BY i.linea)) AS h
      FROM public.pedidos_venta_items i WHERE i.codigo IN (SELECT codigo FROM cods) GROUP BY 1
  )
  SELECT c.codigo FROM cods c
    LEFT JOIN h_in ON h_in.codigo = c.codigo
    LEFT JOIN h_db ON h_db.codigo = c.codigo
   WHERE h_in.h IS DISTINCT FROM h_db.h;

  DELETE FROM public.pedidos_venta_items i WHERE i.codigo IN (SELECT codigo FROM _pvs_cambiados);

  INSERT INTO public.pedidos_venta_items
    (codigo, linea, articulo, descripcion, color, color_nombre, talle, cantidad, precio, neto, iva, bruto)
  SELECT i.codigo, i.linea, i.articulo, i.descripcion, i.color, i.color_nombre, i.talle, i.cantidad, i.precio, i.neto, i.iva, i.bruto
    FROM _pvs_in i WHERE i.codigo IN (SELECT codigo FROM _pvs_cambiados)
  ON CONFLICT (codigo, linea) DO NOTHING;

  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.pedidos_venta_sync_lote(p_token text, p_gen bigint, p_pedidos jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_pedidos) <> 'array' OR jsonb_array_length(p_pedidos) > 500 THEN
    RAISE EXCEPTION 'Lote inválido (máximo 500 pedidos)' USING ERRCODE = '22023';
  END IF;
  RETURN private.pedidos_venta_sync_lote_core(p_gen, p_pedidos);
END;
$$;

REVOKE ALL ON FUNCTION private.pedidos_venta_sync_lote_core(bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pedidos_venta_sync_lote(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pedidos_venta_sync_lote(text, bigint, jsonb) TO anon, authenticated;
