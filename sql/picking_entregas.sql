-- ============================================================================
-- Picking por registros: cada picking de una OC queda guardado aparte
--
-- Aplicado en Supabase (migración picking_entregas). Idempotente.
--
-- Antes se editaba directo el total recibido (picking_compra.recibido). Ahora:
--   picking_entregas        un picking de un pedido: N° (#1, #2…), fecha, usuario,
--                           origen (picking | excel | inicial) y si se anuló
--   picking_entregas_items  lo que se marcó en ese picking (artículo/color/talle)
--   registrar_picking()     guarda un picking nuevo y SUMA a picking_compra.recibido
--   anular_picking()        lo resta y lo deja en el historial como anulado
--   picking_entregas_de()   historial de un pedido (para la pantalla)
-- picking_compra.recibido sigue siendo el total (= suma de los pickings no anulados),
-- así Estado de pedidos, el avance y las cancelaciones no cambian.
-- Lo que ya estaba marcado pasa a ser el Picking #1 (origen 'inicial') de cada OC.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.picking_entregas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      text NOT NULL,
  nro         integer NOT NULL,
  creado_at   timestamptz NOT NULL DEFAULT now(),
  creado_por  uuid DEFAULT auth.uid(),
  origen      text NOT NULL DEFAULT 'picking' CHECK (origen IN ('picking', 'excel', 'inicial')),
  anulado_at  timestamptz,
  anulado_por uuid,
  UNIQUE (codigo, nro)
);

CREATE TABLE IF NOT EXISTS public.picking_entregas_items (
  entrega_id uuid NOT NULL REFERENCES public.picking_entregas (id) ON DELETE CASCADE,
  articulo   text NOT NULL,
  color      text NOT NULL DEFAULT '',
  talle      text NOT NULL DEFAULT '',
  cantidad   numeric NOT NULL CHECK (cantidad > 0),
  PRIMARY KEY (entrega_id, articulo, color, talle)
);

ALTER TABLE public.picking_entregas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.picking_entregas_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS picking_entregas_ver ON public.picking_entregas;
CREATE POLICY picking_entregas_ver ON public.picking_entregas
  FOR SELECT TO authenticated USING (private.tengo_permiso('picking.view'));
DROP POLICY IF EXISTS picking_entregas_items_ver ON public.picking_entregas_items;
CREATE POLICY picking_entregas_items_ver ON public.picking_entregas_items
  FOR SELECT TO authenticated USING (private.tengo_permiso('picking.view'));
-- Altas y anulaciones solo por las funciones de abajo (no hay políticas de escritura)

-- ---- Registrar un picking: p_items = [{articulo, color, talle, cantidad}, …] ----
CREATE OR REPLACE FUNCTION public.registrar_picking(p_codigo text, p_items jsonb, p_origen text DEFAULT 'picking')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nro integer;
  v_id  uuid;
  v_n   integer;
BEGIN
  IF NOT private.tengo_permiso('picking.view') THEN
    RAISE EXCEPTION 'Sin permiso para hacer picking';
  END IF;
  IF coalesce(p_origen, '') NOT IN ('picking', 'excel') THEN
    RAISE EXCEPTION 'Origen inválido: %', p_origen;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pedidos_compra WHERE codigo = p_codigo) THEN
    RAISE EXCEPTION 'No existe el pedido de compra %', p_codigo;
  END IF;

  -- Lo que se marcó, agrupado y solo cantidades positivas
  CREATE TEMP TABLE IF NOT EXISTS _pk (articulo text, color text, talle text, cantidad numeric) ON COMMIT DROP;
  TRUNCATE _pk;
  INSERT INTO _pk
  SELECT upper(trim(x->>'articulo')), coalesce(trim(x->>'color'), ''), coalesce(trim(x->>'talle'), ''),
         sum((x->>'cantidad')::numeric)
    FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   WHERE coalesce(trim(x->>'articulo'), '') <> '' AND coalesce((x->>'cantidad')::numeric, 0) > 0
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No hay nada para registrar en este picking';
  END IF;

  -- Un picking a la vez por pedido (el N° es correlativo)
  PERFORM pg_advisory_xact_lock(hashtext('picking:' || p_codigo));
  SELECT coalesce(max(nro), 0) + 1 INTO v_nro FROM public.picking_entregas WHERE codigo = p_codigo;

  INSERT INTO public.picking_entregas (codigo, nro, origen) VALUES (p_codigo, v_nro, p_origen) RETURNING id INTO v_id;
  INSERT INTO public.picking_entregas_items (entrega_id, articulo, color, talle, cantidad)
  SELECT v_id, articulo, color, talle, cantidad FROM _pk;

  -- Se suma al total recibido
  INSERT INTO public.picking_compra AS k (codigo, articulo, color, talle, recibido)
  SELECT p_codigo, articulo, color, talle, cantidad FROM _pk
  ON CONFLICT (codigo, articulo, color, talle)
  DO UPDATE SET recibido = k.recibido + excluded.recibido;

  RETURN v_nro;
END;
$$;

-- ---- Anular un picking (se resta lo que había sumado) ----
CREATE OR REPLACE FUNCTION public.anular_picking(p_entrega uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.picking_entregas%ROWTYPE;
BEGIN
  IF NOT private.tengo_permiso('picking.view') THEN
    RAISE EXCEPTION 'Sin permiso para hacer picking';
  END IF;
  SELECT * INTO v FROM public.picking_entregas WHERE id = p_entrega FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'No existe ese picking'; END IF;
  IF v.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese picking ya estaba anulado'; END IF;

  UPDATE public.picking_compra k
     SET recibido = greatest(0, k.recibido - i.cantidad)
    FROM public.picking_entregas_items i
   WHERE i.entrega_id = v.id
     AND k.codigo = v.codigo AND k.articulo = i.articulo AND k.color = i.color AND k.talle = i.talle;

  UPDATE public.picking_entregas SET anulado_at = now(), anulado_por = auth.uid() WHERE id = v.id;
END;
$$;

-- ---- Historial de un pedido ----
CREATE OR REPLACE FUNCTION public.picking_entregas_de(p_codigo text)
RETURNS TABLE(id uuid, nro integer, creado_at timestamptz, creado_por text, origen text,
              anulado boolean, unidades numeric, items jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id, e.nro, e.creado_at,
         (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = e.creado_por),
         e.origen, e.anulado_at IS NOT NULL,
         coalesce((SELECT sum(i.cantidad) FROM public.picking_entregas_items i WHERE i.entrega_id = e.id), 0),
         coalesce((SELECT jsonb_agg(jsonb_build_object('articulo', i.articulo, 'color', i.color, 'talle', i.talle, 'cantidad', i.cantidad)
                                    ORDER BY i.articulo, i.color, i.talle)
                     FROM public.picking_entregas_items i WHERE i.entrega_id = e.id), '[]'::jsonb)
    FROM public.picking_entregas e
   WHERE e.codigo = p_codigo AND private.tengo_permiso('picking.view')
   ORDER BY e.nro
$$;

-- ---- Lo que ya estaba marcado = Picking #1 de cada OC ----
DO $$
DECLARE r record; v_id uuid;
BEGIN
  FOR r IN
    SELECT k.codigo, max(k.actualizado_at) AS cuando,
           (array_agg(k.actualizado_por ORDER BY k.actualizado_at DESC NULLS LAST))[1] AS quien
      FROM public.picking_compra k
     WHERE k.recibido > 0
       AND NOT EXISTS (SELECT 1 FROM public.picking_entregas e WHERE e.codigo = k.codigo)
     GROUP BY k.codigo
  LOOP
    INSERT INTO public.picking_entregas (codigo, nro, creado_at, creado_por, origen)
    VALUES (r.codigo, 1, coalesce(r.cuando, now()), r.quien, 'inicial') RETURNING id INTO v_id;
    INSERT INTO public.picking_entregas_items (entrega_id, articulo, color, talle, cantidad)
    SELECT v_id, k.articulo, k.color, k.talle, k.recibido
      FROM public.picking_compra k WHERE k.codigo = r.codigo AND k.recibido > 0;
  END LOOP;
END $$;
