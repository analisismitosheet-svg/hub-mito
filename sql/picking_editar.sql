-- ============================================================================
-- Editar un picking ya registrado (solo admin)
--
-- Antes, un picking mal cargado solo se podía anular y volver a registrar.
-- Ahora el admin puede corregir las cantidades del picking: se recalcula la
-- diferencia contra picking_compra.recibido (el total de la OC) y queda
-- anotado quién lo editó y cuándo.
--
-- Aplicado en Supabase (migración picking_editar). Idempotente.
-- Ver sql/picking_entregas.sql y docs/mapa/Picking.md.
-- ============================================================================

BEGIN;

ALTER TABLE public.picking_entregas ADD COLUMN IF NOT EXISTS editado_at  timestamptz;
ALTER TABLE public.picking_entregas ADD COLUMN IF NOT EXISTS editado_por uuid;

-- ---- Editar: p_items = [{articulo, color, talle, cantidad}, …] (la lista COMPLETA) ----
-- Lo que no venga (o venga en 0) se saca del picking. Para vaciarlo entero: anular_picking().
CREATE OR REPLACE FUNCTION public.editar_picking(p_entrega uuid, p_items jsonb)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.picking_entregas%ROWTYPE;
  v_n integer;
  v_unidades numeric;
BEGIN
  IF NOT private.es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede editar un picking registrado';
  END IF;

  SELECT * INTO v FROM public.picking_entregas WHERE id = p_entrega FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'No existe ese picking'; END IF;
  IF v.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese picking está anulado: no se puede editar'; END IF;

  -- Un cambio a la vez por pedido (igual que registrar_picking)
  PERFORM pg_advisory_xact_lock(hashtext('picking:' || v.codigo));

  -- Lo que queda en el picking, agrupado y solo cantidades positivas
  CREATE TEMP TABLE IF NOT EXISTS _pk_edit (articulo text, color text, talle text, cantidad numeric) ON COMMIT DROP;
  TRUNCATE _pk_edit;
  INSERT INTO _pk_edit
  SELECT upper(trim(x->>'articulo')), coalesce(trim(x->>'color'), ''), coalesce(trim(x->>'talle'), ''),
         sum((x->>'cantidad')::numeric)
    FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
   WHERE coalesce(trim(x->>'articulo'), '') <> '' AND coalesce((x->>'cantidad')::numeric, 0) > 0
   GROUP BY 1, 2, 3;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'El picking quedaría vacío: si no entró nada, anulalo';
  END IF;

  -- Diferencia contra lo que tenía el picking: se aplica al total recibido de la OC
  CREATE TEMP TABLE IF NOT EXISTS _pk_dif (articulo text, color text, talle text, dif numeric) ON COMMIT DROP;
  TRUNCATE _pk_dif;
  INSERT INTO _pk_dif
  SELECT coalesce(n.articulo, a.articulo), coalesce(n.color, a.color), coalesce(n.talle, a.talle),
         coalesce(n.cantidad, 0) - coalesce(a.cantidad, 0)
    FROM (SELECT articulo, color, talle, cantidad FROM public.picking_entregas_items WHERE entrega_id = v.id) a
    FULL JOIN _pk_edit n
      ON n.articulo = a.articulo AND n.color = a.color AND n.talle = a.talle
   WHERE coalesce(n.cantidad, 0) <> coalesce(a.cantidad, 0);

  -- Renglones del picking: se reemplazan por los nuevos
  DELETE FROM public.picking_entregas_items WHERE entrega_id = v.id;
  INSERT INTO public.picking_entregas_items (entrega_id, articulo, color, talle, cantidad)
  SELECT v.id, articulo, color, talle, cantidad FROM _pk_edit;

  -- Total recibido de la OC: suma o resta la diferencia (nunca queda negativo)
  INSERT INTO public.picking_compra (codigo, articulo, color, talle, recibido)
  SELECT v.codigo, articulo, color, talle, 0 FROM _pk_dif
  ON CONFLICT (codigo, articulo, color, talle) DO NOTHING;

  UPDATE public.picking_compra k
     SET recibido = greatest(0, k.recibido + d.dif)
    FROM _pk_dif d
   WHERE k.codigo = v.codigo AND k.articulo = d.articulo AND k.color = d.color AND k.talle = d.talle;

  UPDATE public.picking_entregas SET editado_at = now(), editado_por = auth.uid() WHERE id = v.id;

  SELECT coalesce(sum(cantidad), 0) INTO v_unidades FROM _pk_edit;
  RETURN v_unidades;
END;
$$;

REVOKE ALL ON FUNCTION public.editar_picking(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_picking(uuid, jsonb) TO authenticated;

-- ---- Historial de un pedido: ahora también dice si se editó ----
-- (suma dos columnas al resultado, así que hay que rehacerla)
DROP FUNCTION IF EXISTS public.picking_entregas_de(text);
CREATE FUNCTION public.picking_entregas_de(p_codigo text)
RETURNS TABLE(id uuid, nro integer, creado_at timestamptz, creado_por text, origen text,
              anulado boolean, unidades numeric, items jsonb,
              editado_at timestamptz, editado_por text)
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
         (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = e.editado_por)
    FROM public.picking_entregas e
   WHERE e.codigo = p_codigo AND private.tengo_permiso('picking.view')
   ORDER BY e.nro
$$;

REVOKE ALL ON FUNCTION public.picking_entregas_de(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picking_entregas_de(text) TO authenticated;

COMMIT;
