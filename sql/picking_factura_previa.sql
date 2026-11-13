-- ============================================================================
-- Facturas anteriores al picking por factura = ya tienen picking (13/11/2026)
--
-- Pedido del depósito: todas las facturas que ya estaban en Recepción INDO
-- cuentan como que ya tienen su picking hecho, para que nadie las vuelva a pickear
-- y el botón no las muestre como pendientes.
--
-- Los pickings viejos no se pueden atar 1 a 1 a su factura (muchos caen en varias
-- facturas de la misma OC y 782 facturas no tienen ninguno), así que no se inventan
-- pickings: se guarda una marca "picking previo" por factura + OC.
--
-- Quedan AFUERA las que hoy están sin controlar y en estado "En deposito": esas
-- todavía no tuvieron picking y se tienen que poder pickear.
--
-- Aplicado en Supabase. Idempotente. Ver sql/picking_factura.sql.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.picking_factura_previa (
  factura_clave text NOT NULL,
  numero        text NOT NULL,          -- N° de OC
  n_factura     text,
  creado_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (factura_clave, numero)
);
ALTER TABLE public.picking_factura_previa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.picking_factura_previa FROM anon, authenticated;
-- Sin políticas: se lee y se escribe solo por las funciones SECURITY DEFINER

INSERT INTO public.picking_factura_previa (factura_clave, numero, n_factura)
SELECT DISTINCT ON (private.factura_clave(r.proveedor, r.n_factura), o)
       private.factura_clave(r.proveedor, r.n_factura), o, btrim(r.n_factura)
  FROM public.recepcion_indo r
  CROSS JOIN LATERAL unnest(private.recepcion_ocs(r.n_oc)) o
 WHERE private.factura_clave(r.proveedor, r.n_factura) IS NOT NULL
   AND NOT (r.fecha_controlada IS NULL AND translate(upper(btrim(r.estado)), 'Ó', 'O') LIKE 'EN DEPOSITO%')
   -- si ya tiene un picking nuevo atado, no hace falta la marca
   AND NOT EXISTS (SELECT 1 FROM public.picking_entregas e
                    WHERE e.factura_clave = private.factura_clave(r.proveedor, r.n_factura) AND e.anulado_at IS NULL)
ON CONFLICT DO NOTHING;

-- ---- Registrar: una factura con picking previo en esa OC no se vuelve a pickear ----
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
    IF EXISTS (SELECT 1 FROM public.picking_factura_previa WHERE factura_clave = v_fact AND numero = v_numero) THEN
      RAISE EXCEPTION 'La factura % ya tiene picking en la OC % (anterior al picking por factura): no se puede hacer otro.',
        r.n_factura, v_numero;
    END IF;
  END IF;

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

  INSERT INTO public.picking_compra AS k (codigo, articulo, color, talle, recibido)
  SELECT p_codigo, articulo, color, talle, cantidad FROM _pk
  ON CONFLICT (codigo, articulo, color, talle)
  DO UPDATE SET recibido = k.recibido + excluded.recibido;

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

-- ---- Facturas para Picking: los previos van como {numero, nro: null, previo: true} ----
CREATE OR REPLACE FUNCTION public.picking_facturas(p_numero text DEFAULT NULL)
RETURNS TABLE(clave text, n_factura text, fecha_factura date, proveedor text, n_remito text, n_guia text,
              fecha_ingreso date, estado text, n_oc text, ocs text[], controlada boolean, pickings jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.clave, r.n_factura, r.fecha_factura, r.proveedor, r.n_remito, r.n_guia, r.fecha_ingreso, r.estado,
         r.n_oc, private.recepcion_ocs(r.n_oc), r.fecha_controlada IS NOT NULL,
         coalesce((SELECT jsonb_agg(x.j ORDER BY x.orden) FROM (
                     SELECT jsonb_build_object('codigo', e.codigo, 'numero', pc.numero, 'nro', e.nro, 'previo', false) j, e.creado_at orden
                       FROM public.picking_entregas e
                       LEFT JOIN public.pedidos_compra pc ON pc.codigo = e.codigo
                      WHERE e.factura_clave = private.factura_clave(r.proveedor, r.n_factura) AND e.anulado_at IS NULL
                     UNION ALL
                     SELECT jsonb_build_object('codigo', NULL, 'numero', p.numero, 'nro', NULL, 'previo', true), p.creado_at
                       FROM public.picking_factura_previa p
                      WHERE p.factura_clave = private.factura_clave(r.proveedor, r.n_factura)
                   ) x), '[]'::jsonb)
    FROM public.recepcion_indo r
   WHERE private.tengo_permiso('picking.view')
     AND private.factura_clave(r.proveedor, r.n_factura) IS NOT NULL
     AND (CASE WHEN nullif(btrim(coalesce(p_numero, '')), '') IS NULL THEN r.fecha_controlada IS NULL
               ELSE btrim(p_numero) = ANY (private.recepcion_ocs(r.n_oc)) END)
   ORDER BY r.fecha_controlada IS NOT NULL, r.fecha_ingreso DESC NULLS LAST, r.n_factura
   LIMIT 500
$$;

-- ---- Recepción INDO: nro NULL = picking previo ----
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
  UNION ALL
  SELECT r.clave, p.numero, NULL::integer
    FROM public.recepcion_indo r
    JOIN public.picking_factura_previa p ON p.factura_clave = private.factura_clave(r.proveedor, r.n_factura)
   WHERE r.clave = ANY (coalesce(p_claves, '{}')) AND private.tengo_permiso('deposito.view')
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
