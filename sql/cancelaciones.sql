-- =====================================================
-- CANCELACIONES de pedidos de compra (Compras → Pedidos → Cancelaciones)
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Copia de DWH.dbo.vw_FACT_CANCELADOS (SQL Server principal). La llena
-- puente-sql/scripts/sync-cancelaciones.js (corre junto con la copia de pedidos de compra, cada 1 hora
-- o con "Actualizar datos"), autenticada con el PUENTE_TOKEN (private.clave_sync_ok('puente', …)).
-- El navegador solo lee (permiso pedidos_compra.view). Una fila por cancelación + sus artículos.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cancelaciones (
  nro            text PRIMARY KEY,            -- NRO_CANCELADO ("CANCELADO - 285")
  numero         integer,                     -- 285
  proveedor      text,                        -- PROVEEDOR (nombre)
  fecha          date,                        -- FECHA_COMPROBANTE
  comprobante    text,                        -- COMPROBANTE_PROVEEDOR ("PEDIDODECOMPRA X 00164-00015276")
  nro_pedido     text,                        -- "PEDIDO - 740"
  codigo_pedido  text,                        -- = pedidos_compra.codigo (puede faltar)
  observacion    text,
  sync_gen       bigint NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cancelaciones_fecha_idx ON public.cancelaciones (fecha DESC, numero DESC);
CREATE INDEX IF NOT EXISTS cancelaciones_pedido_idx ON public.cancelaciones (codigo_pedido);

CREATE TABLE IF NOT EXISTS public.cancelaciones_items (
  nro         text NOT NULL REFERENCES public.cancelaciones(nro) ON DELETE CASCADE,
  linea       integer NOT NULL,
  articulo    text,
  descripcion text,
  color       text,
  talle       text,
  cantidad    numeric,
  PRIMARY KEY (nro, linea)
);

CREATE TABLE IF NOT EXISTS public.cancelaciones_sync (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at     timestamptz,
  cancelaciones integer,
  items         integer,
  borrados      integer,
  origen        text
);

ALTER TABLE public.cancelaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelaciones_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelaciones_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cancelaciones, public.cancelaciones_items, public.cancelaciones_sync FROM anon, authenticated;
GRANT SELECT ON public.cancelaciones, public.cancelaciones_items, public.cancelaciones_sync TO authenticated;

DROP POLICY IF EXISTS cancelaciones_ver ON public.cancelaciones;
CREATE POLICY cancelaciones_ver ON public.cancelaciones FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_compra.view') OR private.tengo_permiso('picking.view'));
DROP POLICY IF EXISTS cancelaciones_items_ver ON public.cancelaciones_items;
CREATE POLICY cancelaciones_items_ver ON public.cancelaciones_items FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_compra.view') OR private.tengo_permiso('picking.view'));
DROP POLICY IF EXISTS cancelaciones_sync_ver ON public.cancelaciones_sync;
CREATE POLICY cancelaciones_sync_ver ON public.cancelaciones_sync FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_compra.view') OR private.tengo_permiso('picking.view'));

-- Carga un lote de cancelaciones (cada una con sus artículos)
CREATE OR REPLACE FUNCTION public.cancelaciones_sync_lote(p_token text, p_gen bigint, p_cancelaciones jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_cancelaciones) <> 'array' OR jsonb_array_length(p_cancelaciones) > 500 THEN
    RAISE EXCEPTION 'Lote inválido (máximo 500 cancelaciones)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cancelaciones AS c
    (nro, numero, proveedor, fecha, comprobante, nro_pedido, codigo_pedido, observacion, sync_gen, actualizado_at)
  SELECT trim(f->>'nro'), (f->>'numero')::integer, nullif(trim(f->>'proveedor'), ''), (f->>'fecha')::date,
         nullif(trim(f->>'comprobante'), ''), nullif(trim(f->>'nro_pedido'), ''), nullif(trim(f->>'codigo_pedido'), ''),
         nullif(trim(f->>'observacion'), ''), p_gen, now()
  FROM jsonb_array_elements(p_cancelaciones) f
  WHERE coalesce(trim(f->>'nro'), '') <> ''
  ON CONFLICT (nro) DO UPDATE
    SET numero = excluded.numero, proveedor = excluded.proveedor, fecha = excluded.fecha,
        comprobante = excluded.comprobante, nro_pedido = excluded.nro_pedido, codigo_pedido = excluded.codigo_pedido,
        observacion = excluded.observacion, sync_gen = excluded.sync_gen, actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.cancelaciones_items i
   WHERE i.nro IN (SELECT trim(f->>'nro') FROM jsonb_array_elements(p_cancelaciones) f);

  INSERT INTO public.cancelaciones_items (nro, linea, articulo, descripcion, color, talle, cantidad)
  SELECT trim(f->>'nro'), (it->>'linea')::integer,
         nullif(upper(regexp_replace(coalesce(it->>'articulo', ''), '\s', '', 'g')), ''),
         nullif(trim(it->>'descripcion'), ''), nullif(trim(it->>'color'), ''), nullif(trim(it->>'talle'), ''),
         (it->>'cantidad')::numeric
  FROM jsonb_array_elements(p_cancelaciones) f,
       jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) it
  WHERE coalesce(trim(f->>'nro'), '') <> ''
  ON CONFLICT (nro, linea) DO NOTHING;

  RETURN v_n;
END;
$$;

-- Cierra la corrida: borra las cancelaciones que ya no están en la vista (solo si la corrida quedó completa)
CREATE OR REPLACE FUNCTION public.cancelaciones_sync_fin(p_token text, p_gen bigint, p_total integer, p_origen text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_marcadas integer; v_borradas integer; v_items integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  SELECT count(*) INTO v_marcadas FROM public.cancelaciones WHERE sync_gen = p_gen;
  IF p_total <= 0 OR v_marcadas < p_total THEN
    RAISE EXCEPTION 'Corrida incompleta: % de % cancelaciones; no se borra nada', v_marcadas, p_total USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.cancelaciones WHERE sync_gen <> p_gen;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  SELECT count(*) INTO v_items FROM public.cancelaciones_items;
  INSERT INTO public.cancelaciones_sync (id, ultima_at, cancelaciones, items, borrados, origen)
  VALUES (1, now(), v_marcadas, v_items, v_borradas, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at, cancelaciones = excluded.cancelaciones,
                                 items = excluded.items, borrados = excluded.borrados, origen = excluded.origen;
  RETURN v_borradas;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelaciones_sync_lote(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelaciones_sync_fin(text, bigint, integer, text) FROM PUBLIC;
-- Igual que pedidos_compra_sync_*: el script entra con la clave anon y la protección es el token del puente
GRANT EXECUTE ON FUNCTION public.cancelaciones_sync_lote(text, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelaciones_sync_fin(text, bigint, integer, text) TO anon, authenticated;

COMMIT;
