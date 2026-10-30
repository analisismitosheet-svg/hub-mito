-- =====================================================
-- VENTAS WEB: pedidos de la tienda Tiendanube (Indonesiashop) en el hub
-- Ejecutar con: node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/tiendanube.sql
-- Idempotente.
--
-- Copia de los pedidos de la API de Tiendanube (app privada "acceso hub mito", solo
-- lectura). La llena puente-sql/scripts/sync-tiendanube.js desde la PC central
-- (tarea "MITO - Sync Tiendanube", cada 20 min: lo modificado desde la última
-- corrida), autenticada con el PUENTE_TOKEN (private.clave_sync_ok('puente', …)).
-- El navegador solo lee (permiso tiendanube.view), pantalla Administradores →
-- Ventas web. No se guardan mails, teléfonos, documentos ni direcciones del
-- comprador: solo el nombre y la provincia/ciudad de entrega.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tn_pedidos (
  id             bigint PRIMARY KEY,          -- id del pedido en Tiendanube
  numero         integer,                     -- número que ve el cliente (#43510)
  creado_at      timestamptz NOT NULL,
  modificado_at  timestamptz,                 -- updated_at de Tiendanube
  pagado_at      timestamptz,
  cancelado_at   timestamptz,
  estado         text,                        -- open / closed / cancelled
  estado_pago    text,                        -- pending / authorized / paid / refunded / voided / abandoned…
  estado_envio   text,                        -- unpacked / fulfilled / unfulfilled…
  moneda         text,
  subtotal       numeric,
  descuento      numeric,
  envio          numeric,                     -- costo de envío que pagó el cliente
  total          numeric,
  medio_pago     text,                        -- gateway_name (Mercado Pago, GOcuotas…)
  metodo_pago    text,                        -- credit_card / debit_card / ticket…
  cuotas         integer,
  envio_tipo     text,                        -- ship / pickup
  envio_opcion   text,                        -- "Local Indonesia - Nuevo Centro Shopping", "Andreani"…
  canal          text,                        -- storefront: store / mobile / api…
  utm_source     text,
  cupon          text,
  cliente        text,                        -- nombre de contacto
  provincia      text,
  ciudad         text,
  unidades       numeric,
  sync_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tn_pedidos_creado_idx ON public.tn_pedidos (creado_at DESC);

CREATE TABLE IF NOT EXISTS public.tn_pedidos_items (
  pedido_id   bigint NOT NULL REFERENCES public.tn_pedidos(id) ON DELETE CASCADE,
  linea       integer NOT NULL,
  producto_id bigint,
  variante_id bigint,
  sku         text,
  nombre      text,                           -- nombre del producto sin la variante
  variante    text,                           -- "GRIS / UNICO"
  cantidad    numeric,
  precio      numeric,                        -- precio unitario cobrado
  PRIMARY KEY (pedido_id, linea)
);
CREATE INDEX IF NOT EXISTS tn_pedidos_items_sku_idx ON public.tn_pedidos_items (sku);

CREATE TABLE IF NOT EXISTS public.tn_sync (
  id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at  timestamptz,
  pedidos    integer,                         -- pedidos copiados en la última corrida
  total      integer,                         -- pedidos en la tabla
  origen     text
);

ALTER TABLE public.tn_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tn_pedidos_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tn_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tn_pedidos, public.tn_pedidos_items, public.tn_sync FROM anon, authenticated;
GRANT SELECT ON public.tn_pedidos, public.tn_pedidos_items, public.tn_sync TO authenticated;

DROP POLICY IF EXISTS tn_pedidos_ver ON public.tn_pedidos;
CREATE POLICY tn_pedidos_ver ON public.tn_pedidos FOR SELECT TO authenticated
  USING ((SELECT private.tengo_permiso('tiendanube.view')));
DROP POLICY IF EXISTS tn_pedidos_items_ver ON public.tn_pedidos_items;
CREATE POLICY tn_pedidos_items_ver ON public.tn_pedidos_items FOR SELECT TO authenticated
  USING ((SELECT private.tengo_permiso('tiendanube.view')));
DROP POLICY IF EXISTS tn_sync_ver ON public.tn_sync;
CREATE POLICY tn_sync_ver ON public.tn_sync FOR SELECT TO authenticated
  USING ((SELECT private.tengo_permiso('tiendanube.view')));

-- Permiso propio. No se le da a ningún rol: son números de plata (como Stock
-- valorizado); los administradores lo tienen siempre y al resto se le da a mano.
INSERT INTO public.permisos (clave, modulo, accion, label, orden)
VALUES ('tiendanube.view', 'tiendanube', 'view', 'Ver Ventas web · pedidos de la tienda Tiendanube', 1520)
ON CONFLICT (clave) DO UPDATE SET label = excluded.label, modulo = excluded.modulo, accion = excluded.accion;

-- Carga un lote de pedidos (cada uno con sus productos). Pisa los que ya estaban.
CREATE OR REPLACE FUNCTION public.tn_pedidos_sync_lote(p_token text, p_pedidos jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_pedidos) <> 'array' OR jsonb_array_length(p_pedidos) > 300 THEN
    RAISE EXCEPTION 'Lote inválido (máximo 300 pedidos)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tn_pedidos AS p
    (id, numero, creado_at, modificado_at, pagado_at, cancelado_at, estado, estado_pago, estado_envio, moneda,
     subtotal, descuento, envio, total, medio_pago, metodo_pago, cuotas, envio_tipo, envio_opcion, canal,
     utm_source, cupon, cliente, provincia, ciudad, unidades, sync_at)
  SELECT (f->>'id')::bigint, (f->>'numero')::integer, (f->>'creado_at')::timestamptz, (f->>'modificado_at')::timestamptz,
         (f->>'pagado_at')::timestamptz, (f->>'cancelado_at')::timestamptz,
         f->>'estado', f->>'estado_pago', f->>'estado_envio', f->>'moneda',
         (f->>'subtotal')::numeric, (f->>'descuento')::numeric, (f->>'envio')::numeric, (f->>'total')::numeric,
         f->>'medio_pago', f->>'metodo_pago', (f->>'cuotas')::integer, f->>'envio_tipo', f->>'envio_opcion', f->>'canal',
         f->>'utm_source', f->>'cupon', f->>'cliente', f->>'provincia', f->>'ciudad',
         (SELECT sum((it->>'cantidad')::numeric) FROM jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) it),
         now()
  FROM jsonb_array_elements(p_pedidos) f
  WHERE (f->>'id') IS NOT NULL AND (f->>'creado_at') IS NOT NULL
  ON CONFLICT (id) DO UPDATE
    SET numero = excluded.numero, creado_at = excluded.creado_at, modificado_at = excluded.modificado_at,
        pagado_at = excluded.pagado_at, cancelado_at = excluded.cancelado_at, estado = excluded.estado,
        estado_pago = excluded.estado_pago, estado_envio = excluded.estado_envio, moneda = excluded.moneda,
        subtotal = excluded.subtotal, descuento = excluded.descuento, envio = excluded.envio, total = excluded.total,
        medio_pago = excluded.medio_pago, metodo_pago = excluded.metodo_pago, cuotas = excluded.cuotas,
        envio_tipo = excluded.envio_tipo, envio_opcion = excluded.envio_opcion, canal = excluded.canal,
        utm_source = excluded.utm_source, cupon = excluded.cupon, cliente = excluded.cliente,
        provincia = excluded.provincia, ciudad = excluded.ciudad, unidades = excluded.unidades, sync_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.tn_pedidos_items i
   WHERE i.pedido_id IN (SELECT (f->>'id')::bigint FROM jsonb_array_elements(p_pedidos) f);

  INSERT INTO public.tn_pedidos_items (pedido_id, linea, producto_id, variante_id, sku, nombre, variante, cantidad, precio)
  SELECT (f->>'id')::bigint, it.ord::integer, (it.v->>'producto_id')::bigint, (it.v->>'variante_id')::bigint,
         nullif(trim(it.v->>'sku'), ''), it.v->>'nombre', nullif(it.v->>'variante', ''),
         (it.v->>'cantidad')::numeric, (it.v->>'precio')::numeric
  FROM jsonb_array_elements(p_pedidos) f,
       jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) WITH ORDINALITY AS it(v, ord)
  WHERE (f->>'id') IS NOT NULL AND (f->>'creado_at') IS NOT NULL
  ON CONFLICT (pedido_id, linea) DO NOTHING;

  RETURN v_n;
END;
$$;

-- Cierra la corrida: deja la hora y los totales para la pantalla
CREATE OR REPLACE FUNCTION public.tn_sync_fin(p_token text, p_pedidos integer, p_origen text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  SELECT count(*) INTO v_total FROM public.tn_pedidos;
  INSERT INTO public.tn_sync (id, ultima_at, pedidos, total, origen)
  VALUES (1, now(), p_pedidos, v_total, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at, pedidos = excluded.pedidos,
                                 total = excluded.total, origen = excluded.origen;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.tn_pedidos_sync_lote(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tn_sync_fin(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tn_pedidos_sync_lote(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tn_sync_fin(text, integer, text) TO anon, authenticated;

-- Resumen de la pantalla para un rango de días (hora de Córdoba). Valida el permiso una
-- sola vez y agrupa en la base: no baja miles de filas al navegador.
-- "Vendido" = pago aprobado (paid) y pedido no cancelado.
CREATE OR REPLACE FUNCTION public.tn_ventas_resumen(p_desde date, p_hasta date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT private.tengo_permiso('tiendanube.view') THEN
    RAISE EXCEPTION 'Sin permiso para ver las ventas web' USING ERRCODE = '42501';
  END IF;
  IF p_hasta < p_desde OR p_hasta - p_desde > 400 THEN
    RAISE EXCEPTION 'Rango inválido (máximo 400 días)' USING ERRCODE = '22023';
  END IF;

  WITH ped AS (
    SELECT p.*, (p.creado_at AT TIME ZONE 'America/Argentina/Cordoba')::date AS dia,
           (p.estado_pago = 'paid' AND coalesce(p.estado, '') <> 'cancelled') AS vendido
    FROM public.tn_pedidos p
    WHERE p.creado_at >= (p_desde::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
      AND p.creado_at <  ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Argentina/Cordoba')
  ), ven AS (SELECT * FROM ped WHERE vendido)
  SELECT jsonb_build_object(
    'totales', (SELECT jsonb_build_object(
        'pedidos', (SELECT count(*) FROM ped),
        'vendidos', count(*),
        'facturado', coalesce(sum(total), 0),
        'unidades', coalesce(sum(unidades), 0),
        'envios', coalesce(sum(envio), 0),
        'descuentos', coalesce(sum(descuento), 0),
        'pendientes', (SELECT count(*) FROM ped WHERE estado_pago IN ('pending', 'authorized') AND coalesce(estado, '') <> 'cancelled'),
        'cancelados', (SELECT count(*) FROM ped WHERE estado = 'cancelled')) FROM ven),
    'por_dia', coalesce((SELECT jsonb_agg(jsonb_build_object('dia', dia, 'pedidos', n, 'facturado', t) ORDER BY dia)
        FROM (SELECT dia, count(*) n, sum(total) t FROM ven GROUP BY dia) d), '[]'::jsonb),
    'por_medio', coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', k, 'pedidos', n, 'facturado', t) ORDER BY t DESC)
        FROM (SELECT coalesce(medio_pago, 'Sin dato') k, count(*) n, sum(total) t FROM ven GROUP BY 1) d), '[]'::jsonb),
    'por_envio', coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', k, 'pedidos', n, 'facturado', t) ORDER BY n DESC)
        FROM (SELECT coalesce(envio_opcion, 'Sin dato') k, count(*) n, sum(total) t FROM ven GROUP BY 1) d), '[]'::jsonb),
    'por_provincia', coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', k, 'pedidos', n, 'facturado', t) ORDER BY n DESC)
        FROM (SELECT coalesce(provincia, 'Sin dato') k, count(*) n, sum(total) t FROM ven GROUP BY 1) d), '[]'::jsonb),
    'top_productos', coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', nombre, 'sku', sku, 'unidades', u, 'facturado', t) ORDER BY u DESC)
        FROM (SELECT i.nombre, min(i.sku) sku, sum(i.cantidad) u, sum(i.cantidad * i.precio) t
              FROM ven JOIN public.tn_pedidos_items i ON i.pedido_id = ven.id
              GROUP BY i.nombre ORDER BY sum(i.cantidad) DESC LIMIT 25) d), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.tn_ventas_resumen(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tn_ventas_resumen(date, date) TO authenticated;

COMMIT;
