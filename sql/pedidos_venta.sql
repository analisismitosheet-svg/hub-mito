-- =====================================================
-- PEDIDOS DE VENTA (Mayorista)
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Copia de los comprobantes "PEDIDO" de Dragonfish MITO (mayorista):
-- [MITO].DRAGONFISH_MITO.ZooLogic.COMPROBANTEV + COMPROBANTEVDET, leídos desde el SQL Server
-- de DESKTOP-OA4GU6I (servidor vinculado MITO). La llena puente-sql/scripts/sync-pedidos-venta.js:
--   cada 15 minutos los últimos 7 días (y a pedido desde el hub), todos los días a la madrugada la copia
--   completa (la única que borra los pedidos que ya no están).
-- Autenticada con el PUENTE_TOKEN (private.clave_sync_ok('puente', …)).
-- El navegador solo lee (permiso pedidos_venta.view). Mismo esquema que pedidos_compra.sql.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pedidos_venta (
  codigo           text PRIMARY KEY,          -- id interno de Dragonfish
  numero           integer,                   -- FNUMCOMP
  descripcion      text,                      -- "PEDIDO X 0001-00009878"
  fecha            date,                      -- FFCH
  fecha_alta       timestamptz,               -- FALTAFW + HALTAFW
  cliente          text,                      -- FPERSON (código)
  cliente_nombre   text,                      -- FCLIENTE
  vendedor         text,                      -- FVEN
  observacion      text,
  subtotal         numeric,                   -- FSUBTOT
  impuestos        numeric,                   -- FIMPUESTO
  total            numeric,                   -- FTOTAL
  anulado          boolean NOT NULL DEFAULT false,
  usuario          text,
  base             text,
  sync_gen         bigint NOT NULL,
  actualizado_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pedidos_venta_fecha_idx ON public.pedidos_venta (fecha DESC, numero DESC);
CREATE INDEX IF NOT EXISTS pedidos_venta_gen_idx ON public.pedidos_venta (sync_gen);

CREATE TABLE IF NOT EXISTS public.pedidos_venta_items (
  codigo       text NOT NULL REFERENCES public.pedidos_venta(codigo) ON DELETE CASCADE,
  linea        integer NOT NULL,
  articulo     text,
  descripcion  text,                           -- FTXT (Dragonfish ya la trae en el pedido)
  color        text,                           -- CCOLOR
  color_nombre text,                           -- FCOLTXT
  talle        text,
  cantidad     numeric,
  precio       numeric,
  neto         numeric,
  iva          numeric,
  bruto        numeric,
  PRIMARY KEY (codigo, linea)
);

CREATE TABLE IF NOT EXISTS public.pedidos_venta_sync (
  id        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at timestamptz,                      -- última copia (cualquiera)
  completa_at timestamptz,                    -- última copia completa
  pedidos   integer,
  items     integer,
  borrados  integer,
  origen    text
);

-- ---- Permiso + roles ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('pedidos_venta.view', 'mayorista', 'view', 'Ver pedidos de venta', 871)
ON CONFLICT (clave) DO NOTHING;
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT r.rol, 'pedidos_venta.view'
FROM (VALUES ('mayorista')) AS r(rol)
WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = r.rol AND permiso_clave = 'pedidos_venta.view');

-- ---- RLS: solo lectura con permiso ----
ALTER TABLE public.pedidos_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_venta_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_venta_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedidos_venta, public.pedidos_venta_items, public.pedidos_venta_sync FROM anon, authenticated;
GRANT SELECT ON public.pedidos_venta, public.pedidos_venta_items, public.pedidos_venta_sync TO authenticated;

DROP POLICY IF EXISTS pedidos_venta_ver ON public.pedidos_venta;
CREATE POLICY pedidos_venta_ver ON public.pedidos_venta
  FOR SELECT TO authenticated USING (private.tengo_permiso('pedidos_venta.view'));
DROP POLICY IF EXISTS pedidos_venta_items_ver ON public.pedidos_venta_items;
CREATE POLICY pedidos_venta_items_ver ON public.pedidos_venta_items
  FOR SELECT TO authenticated USING (private.tengo_permiso('pedidos_venta.view'));
DROP POLICY IF EXISTS pedidos_venta_sync_ver ON public.pedidos_venta_sync;
CREATE POLICY pedidos_venta_sync_ver ON public.pedidos_venta_sync
  FOR SELECT TO authenticated USING (private.tengo_permiso('pedidos_venta.view'));

-- ---- Sincronización (script con el token del puente) ----
-- Sube un lote de pedidos completos: [{ codigo, numero, …, items: [{ linea, articulo, … }] }]
-- Cada pedido reemplaza sus ítems.
CREATE OR REPLACE FUNCTION public.pedidos_venta_sync_lote(p_token text, p_gen bigint, p_pedidos jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_pedidos) <> 'array' OR jsonb_array_length(p_pedidos) > 500 THEN
    RAISE EXCEPTION 'Lote inválido (máximo 500 pedidos)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pedidos_venta AS p
    (codigo, numero, descripcion, fecha, fecha_alta, cliente, cliente_nombre, vendedor, observacion,
     subtotal, impuestos, total, anulado, usuario, base, sync_gen, actualizado_at)
  SELECT trim(f->>'codigo'), (f->>'numero')::integer, nullif(trim(f->>'descripcion'), ''),
         (f->>'fecha')::date, (f->>'fecha_alta')::timestamptz,
         nullif(trim(f->>'cliente'), ''), nullif(trim(f->>'cliente_nombre'), ''),
         nullif(trim(f->>'vendedor'), ''), nullif(trim(f->>'observacion'), ''),
         (f->>'subtotal')::numeric, (f->>'impuestos')::numeric, (f->>'total')::numeric,
         coalesce((f->>'anulado')::boolean, false),
         nullif(trim(f->>'usuario'), ''), nullif(trim(f->>'base'), ''), p_gen, now()
  FROM jsonb_array_elements(p_pedidos) f
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo) DO UPDATE
    SET numero = excluded.numero, descripcion = excluded.descripcion, fecha = excluded.fecha,
        fecha_alta = excluded.fecha_alta, cliente = excluded.cliente, cliente_nombre = excluded.cliente_nombre,
        vendedor = excluded.vendedor, observacion = excluded.observacion, subtotal = excluded.subtotal,
        impuestos = excluded.impuestos, total = excluded.total, anulado = excluded.anulado,
        usuario = excluded.usuario, base = excluded.base, sync_gen = excluded.sync_gen,
        actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.pedidos_venta_items i
   WHERE i.codigo IN (SELECT trim(f->>'codigo') FROM jsonb_array_elements(p_pedidos) f);

  INSERT INTO public.pedidos_venta_items
    (codigo, linea, articulo, descripcion, color, color_nombre, talle, cantidad, precio, neto, iva, bruto)
  SELECT trim(f->>'codigo'), (it->>'linea')::integer,
         nullif(upper(regexp_replace(coalesce(it->>'articulo', ''), '\s', '', 'g')), ''),
         nullif(trim(it->>'descripcion'), ''),
         nullif(trim(it->>'color'), ''), nullif(trim(it->>'color_nombre'), ''), nullif(trim(it->>'talle'), ''),
         (it->>'cantidad')::numeric, (it->>'precio')::numeric, (it->>'neto')::numeric,
         (it->>'iva')::numeric, (it->>'bruto')::numeric
  FROM jsonb_array_elements(p_pedidos) f,
       jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) it
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo, linea) DO NOTHING;

  RETURN v_n;
END;
$$;

-- Cierra la corrida. Completa (p_completa): borra los pedidos que ya no están en Dragonfish, solo si
-- se marcaron todos. Parcial (últimos días): no borra nada, solo anota la hora.
CREATE OR REPLACE FUNCTION public.pedidos_venta_sync_fin(p_token text, p_gen bigint, p_total integer, p_origen text,
                                                         p_completa boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_marcados integer; v_borrados integer := 0; v_items integer; v_pedidos integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  -- sync_gen es la hora de inicio de cada corrida: si mientras corría la completa entró una copia
  -- de los últimos días, esos pedidos quedan con un gen MAYOR y también cuentan como vigentes.
  SELECT count(*) INTO v_marcados FROM public.pedidos_venta WHERE sync_gen >= p_gen;
  IF p_total <= 0 OR v_marcados < p_total THEN
    RAISE EXCEPTION 'Corrida incompleta: % de % pedidos; no se borra nada', v_marcados, p_total USING ERRCODE = 'P0001';
  END IF;
  IF p_completa THEN
    DELETE FROM public.pedidos_venta WHERE sync_gen < p_gen;
    GET DIAGNOSTICS v_borrados = ROW_COUNT;
  END IF;
  SELECT count(*) INTO v_pedidos FROM public.pedidos_venta;
  -- Ítems: estimación de las estadísticas (contar 300 mil filas pasa el límite de 3 s de anon)
  SELECT greatest(reltuples, 0)::integer INTO v_items FROM pg_class WHERE oid = 'public.pedidos_venta_items'::regclass;
  INSERT INTO public.pedidos_venta_sync (id, ultima_at, completa_at, pedidos, items, borrados, origen)
  VALUES (1, now(), CASE WHEN p_completa THEN now() END, v_pedidos, v_items, v_borrados, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at,
                                 completa_at = coalesce(excluded.completa_at, public.pedidos_venta_sync.completa_at),
                                 pedidos = excluded.pedidos, items = excluded.items,
                                 borrados = excluded.borrados, origen = excluded.origen;
  RETURN v_borrados;
END;
$$;

REVOKE ALL ON FUNCTION public.pedidos_venta_sync_lote(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pedidos_venta_sync_fin(text, bigint, integer, text, boolean) FROM PUBLIC;
-- El script entra con la clave anon: la protección es el token del puente
GRANT EXECUTE ON FUNCTION public.pedidos_venta_sync_lote(text, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedidos_venta_sync_fin(text, bigint, integer, text, boolean) TO anon, authenticated;

COMMIT;
