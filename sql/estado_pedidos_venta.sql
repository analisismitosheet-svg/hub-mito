-- =====================================================
-- ESTADO DE PEDIDOS DE VENTA (Mayorista → Estado de pedidos)
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Los pedidos de venta de Dragonfish MITO que tienen saldo pendiente (desde 2025), con cada línea:
-- pedido, remitido (remitos tipo 11), facturado (facturas tipo 1), preparado (preparaciones tipo 57),
-- cancelado (cancelaciones de venta tipo 12) y saldo = COMPROBANTEVDET.AFESALDO (el pendiente de Dragon).
-- La llena puente-sql/scripts/sync-estado-pedidos.js al final de sync-pedidos-venta.js (cada 15 minutos).
-- Para no reescribir todo cada vez, cada pedido lleva una huella de sus líneas: solo se suben los que
-- cambiaron y se borran los que ya no tienen saldo. Autenticada con el PUENTE_TOKEN.
-- El navegador solo lee (permiso pedidos_venta.view). No se escribe nada en Dragonfish.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.estado_pedidos (
  codigo         text PRIMARY KEY,            -- id interno de Dragonfish del pedido
  numero         integer,
  fecha          date,
  cliente        text,
  cliente_nombre text,
  motivo         text,
  motivo_nombre  text,
  total          numeric,                     -- FTOTAL del pedido
  lineas         integer,
  lineas_saldo   integer,                     -- líneas con saldo > 0
  u_pedido       numeric,
  u_remitido     numeric,
  u_facturado    numeric,
  u_preparado    numeric,
  u_cancelado    numeric,
  u_saldo        numeric,
  pesos_saldo    numeric,                     -- saldo × precio de cada línea
  -- Comprobantes que le descontaron: [{tipo (11 remito, 1 factura, 57 preparación, 12 cancelación), numero}]
  comprobantes   jsonb NOT NULL DEFAULT '[]'::jsonb,
  huella         text NOT NULL,               -- resumen de las líneas: si no cambia, no se vuelve a subir
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estado_pedidos_cliente_idx ON public.estado_pedidos (cliente);

CREATE TABLE IF NOT EXISTS public.estado_pedidos_items (
  codigo       text NOT NULL REFERENCES public.estado_pedidos(codigo) ON DELETE CASCADE,
  linea        integer NOT NULL,              -- NROITEM del pedido
  articulo     text,
  descripcion  text,
  color        text,
  color_nombre text,
  talle        text,
  pedido       numeric,
  remitido     numeric,
  facturado    numeric,
  preparado    numeric,
  cancelado    numeric,
  saldo        numeric,
  precio       numeric,
  PRIMARY KEY (codigo, linea)
);

CREATE TABLE IF NOT EXISTS public.estado_pedidos_sync (
  id        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at timestamptz,
  pedidos   integer,
  items     integer,
  subidos   integer,                          -- pedidos que cambiaron en la última corrida
  borrados  integer,
  origen    text
);

ALTER TABLE public.estado_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estado_pedidos_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estado_pedidos_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.estado_pedidos, public.estado_pedidos_items, public.estado_pedidos_sync FROM anon, authenticated;
GRANT SELECT ON public.estado_pedidos, public.estado_pedidos_items, public.estado_pedidos_sync TO authenticated;

DROP POLICY IF EXISTS estado_pedidos_ver ON public.estado_pedidos;
CREATE POLICY estado_pedidos_ver ON public.estado_pedidos FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_venta.view'));
DROP POLICY IF EXISTS estado_pedidos_items_ver ON public.estado_pedidos_items;
CREATE POLICY estado_pedidos_items_ver ON public.estado_pedidos_items FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_venta.view'));
DROP POLICY IF EXISTS estado_pedidos_sync_ver ON public.estado_pedidos_sync;
CREATE POLICY estado_pedidos_sync_ver ON public.estado_pedidos_sync FOR SELECT TO authenticated
  USING (private.tengo_permiso('pedidos_venta.view'));

-- Huellas actuales (para que el script suba solo los pedidos que cambiaron)
CREATE OR REPLACE FUNCTION public.estado_pedidos_huellas(p_token text)
RETURNS TABLE (codigo text, huella text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY SELECT e.codigo, e.huella FROM public.estado_pedidos e;
END;
$$;

-- Carga un lote de pedidos (cada uno con sus líneas); reemplaza las líneas de esos pedidos
CREATE OR REPLACE FUNCTION public.estado_pedidos_sync_lote(p_token text, p_pedidos jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_pedidos) <> 'array' OR jsonb_array_length(p_pedidos) > 200 THEN
    RAISE EXCEPTION 'Lote inválido (máximo 200 pedidos)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.estado_pedidos AS e
    (codigo, numero, fecha, cliente, cliente_nombre, motivo, motivo_nombre, total, lineas, lineas_saldo,
     u_pedido, u_remitido, u_facturado, u_preparado, u_cancelado, u_saldo, pesos_saldo, comprobantes, huella, actualizado_at)
  SELECT trim(f->>'codigo'), (f->>'numero')::integer, (f->>'fecha')::date, nullif(trim(f->>'cliente'), ''),
         nullif(trim(f->>'cliente_nombre'), ''), nullif(trim(f->>'motivo'), ''), nullif(trim(f->>'motivo_nombre'), ''),
         (f->>'total')::numeric, (f->>'lineas')::integer, (f->>'lineas_saldo')::integer,
         (f->>'u_pedido')::numeric, (f->>'u_remitido')::numeric, (f->>'u_facturado')::numeric, (f->>'u_preparado')::numeric,
         (f->>'u_cancelado')::numeric, (f->>'u_saldo')::numeric, (f->>'pesos_saldo')::numeric,
         CASE WHEN jsonb_typeof(f->'comprobantes') = 'array' THEN f->'comprobantes' ELSE '[]'::jsonb END,
         coalesce(f->>'huella', ''), now()
  FROM jsonb_array_elements(p_pedidos) f
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo) DO UPDATE
    SET numero = excluded.numero, fecha = excluded.fecha, cliente = excluded.cliente, cliente_nombre = excluded.cliente_nombre,
        motivo = excluded.motivo, motivo_nombre = excluded.motivo_nombre, total = excluded.total, lineas = excluded.lineas,
        lineas_saldo = excluded.lineas_saldo, u_pedido = excluded.u_pedido, u_remitido = excluded.u_remitido,
        u_facturado = excluded.u_facturado, u_preparado = excluded.u_preparado, u_cancelado = excluded.u_cancelado,
        u_saldo = excluded.u_saldo, pesos_saldo = excluded.pesos_saldo, comprobantes = excluded.comprobantes,
        huella = excluded.huella, actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.estado_pedidos_items i
   WHERE i.codigo IN (SELECT trim(f->>'codigo') FROM jsonb_array_elements(p_pedidos) f);

  INSERT INTO public.estado_pedidos_items
    (codigo, linea, articulo, descripcion, color, color_nombre, talle, pedido, remitido, facturado, preparado, cancelado, saldo, precio)
  SELECT trim(f->>'codigo'), (it->>'linea')::integer,
         nullif(upper(regexp_replace(coalesce(it->>'articulo', ''), '\s', '', 'g')), ''),
         nullif(trim(it->>'descripcion'), ''), nullif(trim(it->>'color'), ''), nullif(trim(it->>'color_nombre'), ''),
         nullif(trim(it->>'talle'), ''), (it->>'pedido')::numeric, (it->>'remitido')::numeric, (it->>'facturado')::numeric,
         (it->>'preparado')::numeric, (it->>'cancelado')::numeric, (it->>'saldo')::numeric, (it->>'precio')::numeric
  FROM jsonb_array_elements(p_pedidos) f,
       jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) it
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo, linea) DO NOTHING;

  RETURN v_n;
END;
$$;

-- Cierra la corrida: borra los pedidos que ya no tienen saldo (no vinieron en la lista completa de esta corrida)
CREATE OR REPLACE FUNCTION public.estado_pedidos_sync_fin(p_token text, p_codigos text[], p_subidos integer, p_origen text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_borrados integer; v_pedidos integer; v_items integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF p_codigos IS NULL THEN
    RAISE EXCEPTION 'Falta la lista de pedidos: no se borra nada' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.estado_pedidos WHERE NOT (codigo = ANY (p_codigos));
  GET DIAGNOSTICS v_borrados = ROW_COUNT;
  SELECT count(*) INTO v_pedidos FROM public.estado_pedidos;
  SELECT count(*) INTO v_items FROM public.estado_pedidos_items;
  INSERT INTO public.estado_pedidos_sync (id, ultima_at, pedidos, items, subidos, borrados, origen)
  VALUES (1, now(), v_pedidos, v_items, p_subidos, v_borrados, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at, pedidos = excluded.pedidos, items = excluded.items,
    subidos = excluded.subidos, borrados = excluded.borrados, origen = excluded.origen;
  RETURN v_borrados;
END;
$$;

REVOKE ALL ON FUNCTION public.estado_pedidos_huellas(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.estado_pedidos_sync_lote(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.estado_pedidos_sync_fin(text, text[], integer, text) FROM PUBLIC;
-- Igual que los demás syncs: entra con la service role (o anon) y la protección es el token del puente
GRANT EXECUTE ON FUNCTION public.estado_pedidos_huellas(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.estado_pedidos_sync_lote(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.estado_pedidos_sync_fin(text, text[], integer, text) TO anon, authenticated, service_role;

COMMIT;
