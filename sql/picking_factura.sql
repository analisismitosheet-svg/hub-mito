-- ============================================================================
-- Picking atado a la factura de Recepción INDO (13/11/2026)
--
-- Pedido del depósito:
--   * Todo picking (origen 'picking') va contra una factura cargada en Recepción INDO
--     (public.recepcion_indo con N° de factura). Sin factura no hay picking.
--   * Una factura no puede tener 2 pickings en la misma OC: uno solo vivo por
--     factura + pedido (si una factura trae 2 OC, lleva un picking por cada OC).
--     El modo "Por artículo" suma renglones al picking de esa factura (p_sumar),
--     no abre otro. Para rehacerlo: anular el picking y registrar de nuevo.
--   * Al registrar, la factura pasa a "LISTO PARA CONTROLAR". Si se anula su
--     último picking, vuelve a "En deposito".
--   * "La factura" = proveedor + N° de factura (compactos): si la misma factura
--     está en 2 renglones de la recepción, cuenta como una sola.
--   * El Excel de ingresos (origen 'excel') queda afuera de la regla.
--
-- Aplicado en Supabase (migración picking_factura). Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.picking_entregas ADD COLUMN IF NOT EXISTS recepcion_clave text;
ALTER TABLE public.picking_entregas ADD COLUMN IF NOT EXISTS factura_clave   text;
ALTER TABLE public.picking_entregas ADD COLUMN IF NOT EXISTS n_factura       text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'picking_entregas_recepcion_fk') THEN
    ALTER TABLE public.picking_entregas
      ADD CONSTRAINT picking_entregas_recepcion_fk FOREIGN KEY (recepcion_clave)
      REFERENCES public.recepcion_indo (clave) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- Una factura, un picking vivo por pedido (la regla real vive acá)
CREATE UNIQUE INDEX IF NOT EXISTS picking_entregas_factura_pedido_uq
  ON public.picking_entregas (factura_clave, codigo)
  WHERE anulado_at IS NULL AND factura_clave IS NOT NULL;

-- Clave de la factura: proveedor + N° de factura, sin espacios ni signos
CREATE OR REPLACE FUNCTION private.factura_clave(p_proveedor text, p_factura text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN private.compacto(p_factura) = '' THEN NULL
              ELSE private.compacto(p_proveedor) || '|' || private.compacto(p_factura) END
$$;

-- Las OC de la recepción ("15183/15347" -> {15183,15347})
CREATE OR REPLACE FUNCTION private.recepcion_ocs(p_n_oc text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT btrim(o)) FILTER (WHERE btrim(o) <> ''), '{}')
    FROM unnest(regexp_split_to_array(coalesce(p_n_oc, ''), '[/;,\s]+')) o
$$;

-- ---- Registrar ----
DROP FUNCTION IF EXISTS public.registrar_picking(text, jsonb, text);
CREATE OR REPLACE FUNCTION public.registrar_picking(
  p_codigo    text,
  p_items     jsonb,
  p_origen    text DEFAULT 'picking',
  p_recepcion text DEFAULT NULL,
  p_sumar     boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_nro     integer;
  v_id      uuid;
  v_n       integer;
  v_numero  text;
  r         public.recepcion_indo%ROWTYPE;
  v_fact    text;
  v_exist   public.picking_entregas%ROWTYPE;
BEGIN
  IF NOT private.tengo_permiso('picking.view') THEN
    RAISE EXCEPTION 'Sin permiso para hacer picking';
  END IF;
  IF coalesce(p_origen, '') NOT IN ('picking', 'excel') THEN
    RAISE EXCEPTION 'Origen inválido: %', p_origen;
  END IF;
  SELECT numero::text INTO v_numero FROM public.pedidos_compra WHERE codigo = p_codigo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el pedido de compra %', p_codigo;
  END IF;

  -- La factura: obligatoria para el picking del depósito
  IF p_origen = 'picking' THEN
    IF nullif(btrim(coalesce(p_recepcion, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Elegí la factura de Recepción INDO a la que corresponde este picking';
    END IF;
    SELECT * INTO r FROM public.recepcion_indo WHERE clave = p_recepcion;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Esa recepción ya no existe en Recepción INDO';
    END IF;
    v_fact := private.factura_clave(r.proveedor, r.n_factura);
    IF v_fact IS NULL THEN
      RAISE EXCEPTION 'La recepción no tiene N° de factura: cargala en Recepción INDO antes de hacer el picking';
    END IF;
    IF NOT coalesce(v_numero = ANY (private.recepcion_ocs(r.n_oc)), false) THEN
      RAISE EXCEPTION 'La OC % no figura en la factura % (OC de la recepción: %)',
        v_numero, r.n_factura, coalesce(nullif(btrim(r.n_oc), ''), 'ninguna');
    END IF;
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

  -- Un picking a la vez por pedido (el N° es correlativo) y por factura
  PERFORM pg_advisory_xact_lock(hashtext('picking:' || p_codigo));
  IF v_fact IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('picking-factura:' || v_fact));
    SELECT * INTO v_exist FROM public.picking_entregas
     WHERE factura_clave = v_fact AND codigo = p_codigo AND anulado_at IS NULL
     LIMIT 1;
    IF FOUND THEN
      IF NOT p_sumar THEN
        RAISE EXCEPTION 'La factura % ya tiene el picking #% en la OC %: no se puede hacer otro. Si hay que rehacerlo, anulalo primero.',
          r.n_factura, v_exist.nro, v_numero;
      END IF;
      -- Modo por artículo: se suma al picking de esta factura
      INSERT INTO public.picking_entregas_items AS i (entrega_id, articulo, color, talle, cantidad)
      SELECT v_exist.id, articulo, color, talle, cantidad FROM _pk
      ON CONFLICT (entrega_id, articulo, color, talle) DO UPDATE SET cantidad = i.cantidad + excluded.cantidad;
      INSERT INTO public.picking_compra AS k (codigo, articulo, color, talle, recibido)
      SELECT p_codigo, articulo, color, talle, cantidad FROM _pk
      ON CONFLICT (codigo, articulo, color, talle)
      DO UPDATE SET recibido = k.recibido + excluded.recibido;
      RETURN v_exist.nro;
    END IF;
  END IF;

  SELECT coalesce(max(nro), 0) + 1 INTO v_nro FROM public.picking_entregas WHERE codigo = p_codigo;

  INSERT INTO public.picking_entregas (codigo, nro, origen, recepcion_clave, factura_clave, n_factura)
  VALUES (p_codigo, v_nro, p_origen, r.clave, v_fact, nullif(btrim(coalesce(r.n_factura, '')), ''))
  RETURNING id INTO v_id;
  INSERT INTO public.picking_entregas_items (entrega_id, articulo, color, talle, cantidad)
  SELECT v_id, articulo, color, talle, cantidad FROM _pk;

  -- Se suma al total recibido
  INSERT INTO public.picking_compra AS k (codigo, articulo, color, talle, recibido)
  SELECT p_codigo, articulo, color, talle, cantidad FROM _pk
  ON CONFLICT (codigo, articulo, color, talle)
  DO UPDATE SET recibido = k.recibido + excluded.recibido;

  -- La factura ya tiene picking: queda lista para controlar
  IF v_fact IS NOT NULL THEN
    UPDATE public.recepcion_indo
       SET estado = 'LISTO PARA CONTROLAR'
     WHERE private.factura_clave(proveedor, n_factura) = v_fact
       AND fecha_controlada IS NULL
       AND estado IS DISTINCT FROM 'LISTO PARA CONTROLAR';
  END IF;

  RETURN v_nro;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_picking(text, jsonb, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_picking(text, jsonb, text, text, boolean) TO authenticated;

-- ---- Anular (si era el último picking de la factura, vuelve a "En deposito") ----
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

  IF v.factura_clave IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.picking_entregas WHERE factura_clave = v.factura_clave AND anulado_at IS NULL
  ) THEN
    UPDATE public.recepcion_indo
       SET estado = 'En deposito'
     WHERE private.factura_clave(proveedor, n_factura) = v.factura_clave
       AND fecha_controlada IS NULL
       AND estado = 'LISTO PARA CONTROLAR';
  END IF;
END;
$$;

-- ---- Historial de un pedido: ahora con la factura de cada picking ----
DROP FUNCTION IF EXISTS public.picking_entregas_de(text);
CREATE FUNCTION public.picking_entregas_de(p_codigo text)
RETURNS TABLE(id uuid, nro integer, creado_at timestamptz, creado_por text, origen text, anulado boolean,
              unidades numeric, items jsonb, editado_at timestamptz, editado_por text,
              recepcion_clave text, n_factura text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id, e.nro, e.creado_at,
         (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = e.creado_por),
         e.origen, e.anulado_at IS NOT NULL,
         coalesce((SELECT sum(i.cantidad) FROM public.picking_entregas_items i WHERE i.entrega_id = e.id), 0),
         coalesce((SELECT jsonb_agg(jsonb_build_object('articulo', i.articulo, 'color', i.color, 'talle', i.talle, 'cantidad', i.cantidad)
                                    ORDER BY i.articulo, i.color, i.talle)
                     FROM public.picking_entregas_items i WHERE i.entrega_id = e.id), '[]'::jsonb),
         e.editado_at,
         (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = e.editado_por),
         e.recepcion_clave, e.n_factura
    FROM public.picking_entregas e
   WHERE e.codigo = p_codigo AND private.tengo_permiso('picking.view')
   ORDER BY e.nro
$$;
REVOKE ALL ON FUNCTION public.picking_entregas_de(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picking_entregas_de(text) TO authenticated;

-- ---- Facturas para elegir en Picking ----
-- p_numero: solo las facturas que traen esa OC. Sin número: todas las que falta controlar.
-- pickings: los pickings vivos de la factura [{codigo, numero, nro}].
CREATE OR REPLACE FUNCTION public.picking_facturas(p_numero text DEFAULT NULL)
RETURNS TABLE(clave text, n_factura text, fecha_factura date, proveedor text, n_remito text, n_guia text,
              fecha_ingreso date, estado text, n_oc text, ocs text[], controlada boolean, pickings jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.clave, r.n_factura, r.fecha_factura, r.proveedor, r.n_remito, r.n_guia, r.fecha_ingreso, r.estado,
         r.n_oc, private.recepcion_ocs(r.n_oc), r.fecha_controlada IS NOT NULL,
         coalesce((SELECT jsonb_agg(jsonb_build_object('codigo', e.codigo, 'numero', pc.numero, 'nro', e.nro) ORDER BY e.creado_at)
                     FROM public.picking_entregas e
                     LEFT JOIN public.pedidos_compra pc ON pc.codigo = e.codigo
                    WHERE e.factura_clave = private.factura_clave(r.proveedor, r.n_factura) AND e.anulado_at IS NULL), '[]'::jsonb)
    FROM public.recepcion_indo r
   WHERE private.tengo_permiso('picking.view')
     AND private.factura_clave(r.proveedor, r.n_factura) IS NOT NULL
     AND (CASE WHEN nullif(btrim(coalesce(p_numero, '')), '') IS NULL THEN r.fecha_controlada IS NULL
               ELSE btrim(p_numero) = ANY (private.recepcion_ocs(r.n_oc)) END)
   ORDER BY r.fecha_controlada IS NOT NULL, r.fecha_ingreso DESC NULLS LAST, r.n_factura
   LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.picking_facturas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picking_facturas(text) TO authenticated;

-- ---- Para la tabla de Recepción INDO: qué facturas ya tienen picking ----
CREATE OR REPLACE FUNCTION public.recepcion_indo_pickings(p_claves text[])
RETURNS TABLE(clave text, numero text, nro integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.clave, pc.numero::text, e.nro
    FROM public.recepcion_indo r
    JOIN public.picking_entregas e
      ON e.factura_clave = private.factura_clave(r.proveedor, r.n_factura) AND e.anulado_at IS NULL
    LEFT JOIN public.pedidos_compra pc ON pc.codigo = e.codigo
   WHERE r.clave = ANY (coalesce(p_claves, '{}')) AND private.tengo_permiso('deposito.view')
$$;
REVOKE ALL ON FUNCTION public.recepcion_indo_pickings(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_pickings(text[]) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
