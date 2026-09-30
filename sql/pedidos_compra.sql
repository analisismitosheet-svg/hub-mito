-- =====================================================
-- PEDIDOS DE COMPRA (Compras / Depósito)
-- Ejecutar en Supabase SQL Editor. Idempotente. (Ya aplicado en hub-mito.)
--
-- Copia de VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA (SQL Server de DESKTOP-OA4GU6I)
-- + nombre del proveedor (ZooLogic.PROV). La llena
-- puente-sql/scripts/sync-pedidos-compra.js cada 1 hora (o a pedido desde el hub), autenticada con
-- el PUENTE_TOKEN (private.clave_sync_ok('puente', …)).
-- El navegador solo lee (permiso pedidos_compra.view).
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pedidos_compra (
  codigo           text PRIMARY KEY,          -- id interno de Dragonfish
  numero           integer,                   -- FNUMCOMP
  descripcion      text,                      -- "PEDIDODECOMPRA X 00001-00009787"
  fecha            date,                      -- FFCH
  fecha_alta       timestamptz,               -- FALTAFW + HALTAFW
  proveedor        text,                      -- FPERSON
  proveedor_nombre text,                      -- PROV.CLNOM
  lista            text,
  observacion      text,
  total            numeric,
  anulado          boolean NOT NULL DEFAULT false,
  usuario          text,
  base             text,
  sync_gen         bigint NOT NULL,
  actualizado_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pedidos_compra_fecha_idx ON public.pedidos_compra (fecha DESC, numero DESC);

CREATE TABLE IF NOT EXISTS public.pedidos_compra_items (
  codigo    text NOT NULL REFERENCES public.pedidos_compra(codigo) ON DELETE CASCADE,
  linea     integer NOT NULL,
  articulo  text,
  color     text,
  talle     text,
  cantidad  numeric,
  precio    numeric,
  neto      numeric,
  iva       numeric,
  bruto     numeric,
  PRIMARY KEY (codigo, linea)
);

CREATE TABLE IF NOT EXISTS public.pedidos_compra_sync (
  id        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultima_at timestamptz,
  pedidos   integer,
  items     integer,
  borrados  integer,
  origen    text
);

-- ---- Permiso + roles ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('pedidos_compra.view', 'compras', 'view', 'Ver pedidos de compra', 870)
ON CONFLICT (clave) DO NOTHING;
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT r.rol, 'pedidos_compra.view'
FROM (VALUES ('compras'), ('deposito')) AS r(rol)
WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = r.rol AND permiso_clave = 'pedidos_compra.view');

-- ---- RLS: solo lectura con permiso ----
ALTER TABLE public.pedidos_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_compra_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_compra_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedidos_compra, public.pedidos_compra_items, public.pedidos_compra_sync FROM anon, authenticated;
GRANT SELECT ON public.pedidos_compra, public.pedidos_compra_items, public.pedidos_compra_sync TO authenticated;

DROP POLICY IF EXISTS pedidos_compra_ver ON public.pedidos_compra;
CREATE POLICY pedidos_compra_ver ON public.pedidos_compra
  FOR SELECT TO authenticated USING (private.tengo_permiso('pedidos_compra.view'));
DROP POLICY IF EXISTS pedidos_compra_items_ver ON public.pedidos_compra_items;
CREATE POLICY pedidos_compra_items_ver ON public.pedidos_compra_items
  FOR SELECT TO authenticated USING (private.tengo_permiso('pedidos_compra.view'));
DROP POLICY IF EXISTS pedidos_compra_sync_ver ON public.pedidos_compra_sync;
CREATE POLICY pedidos_compra_sync_ver ON public.pedidos_compra_sync
  FOR SELECT TO authenticated USING (private.tengo_permiso('pedidos_compra.view'));

-- ---- Sincronización (script con el token del puente) ----
-- Sube un lote de pedidos completos: [{ codigo, numero, …, items: [{ linea, articulo, … }] }]
-- Cada pedido reemplaza sus ítems.
CREATE OR REPLACE FUNCTION public.pedidos_compra_sync_lote(p_token text, p_gen bigint, p_pedidos jsonb)
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

  INSERT INTO public.pedidos_compra AS p
    (codigo, numero, descripcion, fecha, fecha_alta, proveedor, proveedor_nombre, lista, observacion,
     total, anulado, usuario, base, sync_gen, actualizado_at)
  SELECT trim(f->>'codigo'), (f->>'numero')::integer, nullif(trim(f->>'descripcion'), ''),
         (f->>'fecha')::date, (f->>'fecha_alta')::timestamptz,
         nullif(trim(f->>'proveedor'), ''), nullif(trim(f->>'proveedor_nombre'), ''),
         nullif(trim(f->>'lista'), ''), nullif(trim(f->>'observacion'), ''),
         (f->>'total')::numeric, coalesce((f->>'anulado')::boolean, false),
         nullif(trim(f->>'usuario'), ''), nullif(trim(f->>'base'), ''), p_gen, now()
  FROM jsonb_array_elements(p_pedidos) f
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo) DO UPDATE
    SET numero = excluded.numero, descripcion = excluded.descripcion, fecha = excluded.fecha,
        fecha_alta = excluded.fecha_alta, proveedor = excluded.proveedor,
        proveedor_nombre = excluded.proveedor_nombre, lista = excluded.lista,
        observacion = excluded.observacion, total = excluded.total, anulado = excluded.anulado,
        usuario = excluded.usuario, base = excluded.base, sync_gen = excluded.sync_gen,
        actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.pedidos_compra_items i
   WHERE i.codigo IN (SELECT trim(f->>'codigo') FROM jsonb_array_elements(p_pedidos) f);

  INSERT INTO public.pedidos_compra_items (codigo, linea, articulo, color, talle, cantidad, precio, neto, iva, bruto)
  SELECT trim(f->>'codigo'), (it->>'linea')::integer,
         nullif(upper(regexp_replace(coalesce(it->>'articulo', ''), '\s', '', 'g')), ''),
         nullif(trim(it->>'color'), ''), nullif(trim(it->>'talle'), ''),
         (it->>'cantidad')::numeric, (it->>'precio')::numeric, (it->>'neto')::numeric,
         (it->>'iva')::numeric, (it->>'bruto')::numeric
  FROM jsonb_array_elements(p_pedidos) f,
       jsonb_array_elements(coalesce(f->'items', '[]'::jsonb)) it
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo, linea) DO NOTHING;

  RETURN v_n;
END;
$$;

-- Cierra la corrida: borra los pedidos que ya no están en la vista (solo si la corrida quedó completa).
CREATE OR REPLACE FUNCTION public.pedidos_compra_sync_fin(p_token text, p_gen bigint, p_total integer, p_origen text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_marcados integer; v_borrados integer; v_items integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  SELECT count(*) INTO v_marcados FROM public.pedidos_compra WHERE sync_gen = p_gen;
  IF p_total <= 0 OR v_marcados < p_total THEN
    RAISE EXCEPTION 'Corrida incompleta: % de % pedidos; no se borra nada', v_marcados, p_total USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.pedidos_compra WHERE sync_gen <> p_gen;
  GET DIAGNOSTICS v_borrados = ROW_COUNT;
  SELECT count(*) INTO v_items FROM public.pedidos_compra_items;
  INSERT INTO public.pedidos_compra_sync (id, ultima_at, pedidos, items, borrados, origen)
  VALUES (1, now(), v_marcados, v_items, v_borrados, left(p_origen, 200))
  ON CONFLICT (id) DO UPDATE SET ultima_at = excluded.ultima_at, pedidos = excluded.pedidos,
                                 items = excluded.items, borrados = excluded.borrados, origen = excluded.origen;
  RETURN v_borrados;
END;
$$;

REVOKE ALL ON FUNCTION public.pedidos_compra_sync_lote(text, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pedidos_compra_sync_fin(text, bigint, integer, text) FROM PUBLIC;
-- El script entra con la clave anon: la protección es el token del puente
GRANT EXECUTE ON FUNCTION public.pedidos_compra_sync_lote(text, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedidos_compra_sync_fin(text, bigint, integer, text) TO anon, authenticated;

COMMIT;
