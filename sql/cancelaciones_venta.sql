-- =====================================================
-- CANCELACIONES DE VENTA (Mayorista → Cancelaciones de venta)
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Copia de las «Cancelación de venta» de Dragonfish MITO (COMPROBANTEV FACTTIPO 12 + COMPROBANTEVDET),
-- con los comprobantes que afecta cada una (ZooLogic.COMPAFE: pedidos tipo 23, remitos tipo 11) y el motivo.
-- La llena puente-sql/scripts/sync-cancelaciones-venta.js, que corre al final de sync-pedidos-venta.js:
-- cada 15 minutos los últimos 2 días y todos los días a las 6:30 los últimos 120 días (borra lo más viejo).
-- Autenticada con el PUENTE_TOKEN (private.clave_sync_ok('puente', …)).
-- El navegador solo lee (permiso pedidos_venta.view). No se escribe nada en Dragonfish.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cancelaciones_venta (
  codigo         text PRIMARY KEY,            -- id interno de Dragonfish
  numero         integer,                     -- FNUMCOMP
  fecha          date,                        -- FFCH
  hora           text,                        -- HALTAFW (HH:MM)
  cliente        text,                        -- FPERSON
  cliente_nombre text,                        -- FCLIENTE
  usuario        text,                        -- UALTAFW (quién la cargó)
  observacion    text,                        -- FOBS
  motivo         text,                        -- MOTIVO (código)
  motivo_nombre  text,                        -- ZooLogic.MOTIVO.MOTDES
  total          numeric,                     -- FTOTAL
  unidades       numeric,                     -- suma de FCANT
  anulado        boolean NOT NULL DEFAULT false,
  -- Comprobantes que afecta: [{codigo, tipo (23 pedido / 11 remito), numero, comprobante, fecha, total}]
  afecta         jsonb NOT NULL DEFAULT '[]'::jsonb,
  sync_gen       bigint NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cancelaciones_venta_fecha_idx ON public.cancelaciones_venta (fecha DESC, numero DESC);

CREATE TABLE IF NOT EXISTS public.cancelaciones_venta_items (
  codigo       text NOT NULL REFERENCES public.cancelaciones_venta(codigo) ON DELETE CASCADE,
  linea        integer NOT NULL,
  articulo     text,
  descripcion  text,                          -- FTXT
  color        text,                          -- CCOLOR
  color_nombre text,                          -- FCOLTXT
  talle        text,
  cantidad     numeric,
  precio       numeric,
  PRIMARY KEY (codigo, linea)
);

CREATE TABLE IF NOT EXISTS public.cancelaciones_venta_sync (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at     timestamptz,                  -- última copia (cualquiera)
  completa_at   timestamptz,                  -- última copia de 120 días
  cancelaciones integer,
  items         integer,
  borrados      integer,
  origen        text
);

ALTER TABLE public.cancelaciones_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelaciones_venta_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancelaciones_venta_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cancelaciones_venta, public.cancelaciones_venta_items, public.cancelaciones_venta_sync FROM anon, authenticated;
GRANT SELECT ON public.cancelaciones_venta, public.cancelaciones_venta_items, public.cancelaciones_venta_sync TO authenticated;

DROP POLICY IF EXISTS cancelaciones_venta_ver ON public.cancelaciones_venta;
CREATE POLICY cancelaciones_venta_ver ON public.cancelaciones_venta FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_venta.view'));
DROP POLICY IF EXISTS cancelaciones_venta_items_ver ON public.cancelaciones_venta_items;
CREATE POLICY cancelaciones_venta_items_ver ON public.cancelaciones_venta_items FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_venta.view'));
DROP POLICY IF EXISTS cancelaciones_venta_sync_ver ON public.cancelaciones_venta_sync;
CREATE POLICY cancelaciones_venta_sync_ver ON public.cancelaciones_venta_sync FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_venta.view'));

-- Carga un lote de cancelaciones (cada una con sus renglones)
CREATE OR REPLACE FUNCTION public.cancelaciones_venta_sync_lote(p_token text, p_gen bigint, p_cancelaciones jsonb)
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

  INSERT INTO public.cancelaciones_venta AS c
    (codigo, numero, fecha, hora, cliente, cliente_nombre, usuario, observacion, motivo, motivo_nombre,
     total, unidades, anulado, afecta, sync_gen, actualizado_at)
  SELECT trim(f->>'codigo'), (f->>'numero')::integer, (f->>'fecha')::date, nullif(trim(f->>'hora'), ''),
         nullif(trim(f->>'cliente'), ''), nullif(trim(f->>'cliente_nombre'), ''), nullif(trim(f->>'usuario'), ''),
         nullif(trim(f->>'observacion'), ''), nullif(trim(f->>'motivo'), ''), nullif(trim(f->>'motivo_nombre'), ''),
         (f->>'total')::numeric, (f->>'unidades')::numeric, coalesce((f->>'anulado')::boolean, false),
         CASE WHEN jsonb_typeof(f->'afecta') = 'array' THEN f->'afecta' ELSE '[]'::jsonb END,
         p_gen, now()
  FROM jsonb_array_elements(p_cancelaciones) f
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo) DO UPDATE
    SET numero = excluded.numero, fecha = excluded.fecha, hora = excluded.hora, cliente = excluded.cliente,
        cliente_nombre = excluded.cliente_nombre, usuario = excluded.usuario, observacion = excluded.observacion,
        motivo = excluded.motivo, motivo_nombre = excluded.motivo_nombre, total = excluded.total,
        unidades = excluded.unidades, anulado = excluded.anulado, afecta = excluded.afecta,
        sync_gen = excluded.sync_gen, actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.cancelaciones_venta_items i
   WHERE i.codigo IN (SELECT trim(f->>'codigo') FROM jsonb_array_elements(p_cancelaciones) f);

  INSERT INTO public.cancelaciones_venta_items (codigo, linea, articulo, descripcion, color, color_nombre, talle, cantidad, precio)
  SELECT trim(f->>'codigo'), (it->>'linea')::integer,
         nullif(upper(regexp_replace(coalesce(it->>'articulo', ''), '\s', '', 'g')), ''),
         nullif(trim(it->>'descripcion'), ''), nullif(trim(it->>'color'), ''), nullif(trim(it->>'color_nombre'), ''),
         nullif(trim(it->>'talle'), ''), (it->>'cantidad')::numeric, (it->>'precio')::numeric
  FROM jsonb_array_elements(p_cancelaciones) f,
       jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) it
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo, linea) DO NOTHING;

  RETURN v_n;
END;
$$;

-- Cierra la corrida: dentro de la ventana leída borra las que ya no están en Dragonfish;
-- en la copia completa además borra las anteriores a la ventana (solo si la corrida quedó completa)
CREATE OR REPLACE FUNCTION public.cancelaciones_venta_sync_fin(
  p_token text, p_gen bigint, p_total integer, p_origen text, p_desde date, p_completa boolean)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_marcadas integer; v_borradas integer; v_viejas integer := 0; v_items integer; v_cabeceras integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  SELECT count(*) INTO v_marcadas FROM public.cancelaciones_venta WHERE sync_gen = p_gen;
  IF p_total <= 0 OR v_marcadas < p_total THEN
    RAISE EXCEPTION 'Corrida incompleta: % de % cancelaciones; no se borra nada', v_marcadas, p_total USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.cancelaciones_venta WHERE fecha >= p_desde AND sync_gen <> p_gen;
  GET DIAGNOSTICS v_borradas = ROW_COUNT;
  IF p_completa THEN
    DELETE FROM public.cancelaciones_venta WHERE fecha < p_desde;
    GET DIAGNOSTICS v_viejas = ROW_COUNT;
  END IF;
  SELECT count(*) INTO v_cabeceras FROM public.cancelaciones_venta;
  SELECT count(*) INTO v_items FROM public.cancelaciones_venta_items;
  INSERT INTO public.cancelaciones_venta_sync (id, ultima_at, completa_at, cancelaciones, items, borrados, origen)
  VALUES (1, now(), CASE WHEN p_completa THEN now() END, v_cabeceras, v_items, v_borradas + v_viejas, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at,
    completa_at = coalesce(excluded.completa_at, public.cancelaciones_venta_sync.completa_at),
    cancelaciones = excluded.cancelaciones, items = excluded.items, borrados = excluded.borrados, origen = excluded.origen;
  RETURN v_borradas + v_viejas;
END;
$$;

REVOKE ALL ON FUNCTION public.cancelaciones_venta_sync_lote(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancelaciones_venta_sync_fin(text, bigint, integer, text, date, boolean) FROM PUBLIC;
-- Igual que pedidos_venta_sync_*: el script entra con la service role (o anon) y la protección es el token del puente
GRANT EXECUTE ON FUNCTION public.cancelaciones_venta_sync_lote(text, bigint, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancelaciones_venta_sync_fin(text, bigint, integer, text, date, boolean) TO anon, authenticated, service_role;

COMMIT;
