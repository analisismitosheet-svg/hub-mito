-- ============================================================================
-- Control físico de mercadería · Depósito Indo (27/11/2026)
-- Maqueta: mockups/control-mercaderia-indo.html
--
-- Flujo:
--   1. Compras hace el picking contra la factura de Recepción INDO (ya existía,
--      sql/picking_factura.sql). La factura pasa a «LISTO PARA CONTROLAR».
--   2. Recién ahí se habilita el control físico: un operario (rol deposito o
--      legajo de Depósito Indo) cuenta en el celular cada renglón del picking.
--   3. Renglones con color 00 o talle U (en Dragon Indo esos artículos están
--      dados de alta solo como 00 / UNICO) se DESGLOSAN en color × talle con
--      colores y talles de los maestros de Dragon (vw_COLORES_INDOD /
--      vw_TALLES_INDOD, sql/vw_COLORES_TALLES_INDOD.sql). Siempre: no hay
--      «es único».
--   4. Al terminar se marca «Controlada» en Recepción INDO (fecha + quién)
--      siempre, con o sin diferencias, y se avisa al depósito (push + campana).
--
--   El desglose NO reemplaza el renglón del picking: queda guardado aparte y
--   se ve desplegando el renglón (Picking y Controles físicos).
--
-- Una factura = un control (factura_clave = proveedor|factura compactos, igual
-- que picking_entregas). Los renglones salen siempre del picking vivo de esa
-- factura; lo contado se guarda por pedido + artículo + color + talle.
--
-- Tablas sin acceso directo: todo va por las RPC de abajo.
-- Aplicar: node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/control_fisico.sql
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.control_fisico (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_clave    text NOT NULL UNIQUE,
  recepcion_clave  text REFERENCES public.recepcion_indo (clave) ON UPDATE CASCADE ON DELETE SET NULL,
  estado           text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'terminado')),
  iniciado_por     uuid,
  iniciado_nombre  text,
  iniciado_at      timestamptz NOT NULL DEFAULT now(),
  terminado_por    uuid,
  terminado_nombre text,
  terminado_at     timestamptz,
  unidades_picking numeric,
  unidades_contadas numeric,
  faltan           numeric,
  sobran           numeric,
  faltan_importe   numeric,
  sobran_importe   numeric,
  con_diferencias  boolean,
  push_at          timestamptz
);

CREATE TABLE IF NOT EXISTS public.control_fisico_lineas (
  control_id         uuid NOT NULL REFERENCES public.control_fisico (id) ON DELETE CASCADE,
  codigo             text NOT NULL,   -- pedido de compra (picking_entregas.codigo)
  articulo           text NOT NULL,
  color              text NOT NULL,
  talle              text NOT NULL,
  contado            numeric NOT NULL CHECK (contado >= 0),
  motivo             text,
  -- [{color, color_desc, talle, cantidad}] solo en renglones 00 / U
  desglose           jsonb,
  actualizado_por    uuid,
  actualizado_nombre text,
  actualizado_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (control_id, codigo, articulo, color, talle)
);

-- Quién ya vio el aviso «Control físico terminado» (la campana no lo vuelve a mostrar)
CREATE TABLE IF NOT EXISTS public.control_fisico_vistos (
  control_id uuid NOT NULL REFERENCES public.control_fisico (id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL,
  visto_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (control_id, usuario_id)
);

ALTER TABLE public.control_fisico        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_fisico_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_fisico_vistos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.control_fisico, public.control_fisico_lineas, public.control_fisico_vistos FROM anon, authenticated;

-- ---------------------------------------------------------------- permisos
-- Ve: depósito, compras (picking), recepción y admin. Cuenta: depósito y admin.
CREATE OR REPLACE FUNCTION private.cf_cuenta()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(private.es_admin(), false) OR coalesce(private.recibe_avisos_indo(auth.uid()), false)
$$;
CREATE OR REPLACE FUNCTION private.cf_ve()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT private.cf_cuenta() OR private.tengo_permiso('picking.view') OR private.tengo_permiso('deposito.view')
$$;
CREATE OR REPLACE FUNCTION private.cf_mi_nombre()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION private.cf_cuenta(), private.cf_ve(), private.cf_mi_nombre() FROM anon, public;

-- Color 00 / talle U (o vacíos): hay que desglosar
CREATE OR REPLACE FUNCTION private.cf_requiere_desglose(p_color text, p_talle text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(btrim(coalesce(p_color, ''))) IN ('', '0', '00')
      OR upper(btrim(coalesce(p_talle, ''))) IN ('', 'U', 'UNICO', 'ÚNICO')
$$;

-- ---------------------------------------------------------------- renglones
-- El picking vivo de la factura + precio de compra de la OC + lo contado
CREATE OR REPLACE FUNCTION private.cf_lineas(p_factura text)
RETURNS TABLE(codigo text, numero text, articulo text, descripcion text, color text, talle text,
              picking numeric, precio numeric, requiere_desglose boolean,
              contado numeric, motivo text, desglose jsonb, actualizado_nombre text, actualizado_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH pk AS (
    SELECT e.codigo, upper(btrim(i.articulo)) AS articulo, btrim(coalesce(i.color, '')) AS color,
           btrim(coalesce(i.talle, '')) AS talle, sum(i.cantidad) AS picking
      FROM public.picking_entregas e
      JOIN public.picking_entregas_items i ON i.entrega_id = e.id
     WHERE e.factura_clave = p_factura AND e.anulado_at IS NULL
     GROUP BY 1, 2, 3, 4
    HAVING sum(i.cantidad) <> 0
  )
  SELECT pk.codigo, pc.numero::text, pk.articulo, a.descripcion, pk.color, pk.talle, pk.picking,
         pr.precio, private.cf_requiere_desglose(pk.color, pk.talle),
         l.contado, l.motivo, l.desglose, l.actualizado_nombre, l.actualizado_at
    FROM pk
    LEFT JOIN public.pedidos_compra pc ON pc.codigo = pk.codigo
    LEFT JOIN public.articulos a ON a.id_art = pk.articulo
    LEFT JOIN LATERAL (
      SELECT round(coalesce(sum(ci.precio * ci.cantidad) / nullif(sum(ci.cantidad), 0), max(ci.precio)), 2) AS precio
        FROM public.pedidos_compra_items ci
       WHERE ci.codigo = pk.codigo AND upper(btrim(ci.articulo)) = pk.articulo
         AND btrim(coalesce(ci.color, '')) = pk.color AND btrim(coalesce(ci.talle, '')) = pk.talle
    ) pr ON true
    LEFT JOIN public.control_fisico c ON c.factura_clave = p_factura
    LEFT JOIN public.control_fisico_lineas l
      ON l.control_id = c.id AND l.codigo = pk.codigo AND l.articulo = pk.articulo
     AND l.color = pk.color AND l.talle = pk.talle
   ORDER BY pk.articulo, pk.color, pk.talle, pc.numero
$$;
REVOKE ALL ON FUNCTION private.cf_lineas(text) FROM anon, public;

-- ---------------------------------------------------------------- lista
-- Facturas con picking vivo que todavía no se controlaron a mano, o que ya tienen control
CREATE OR REPLACE FUNCTION public.control_fisico_lista()
RETURNS TABLE(factura_clave text, recepcion_clave text, proveedor text, n_factura text, n_oc text,
              fecha_ingreso date, control_id uuid, estado text,
              iniciado_nombre text, iniciado_at timestamptz, terminado_nombre text, terminado_at timestamptz,
              renglones integer, para_desglosar integer, desglosados integer, controlados integer,
              unidades_picking numeric, unidades_contadas numeric,
              importe_picking numeric, faltan numeric, sobran numeric,
              faltan_importe numeric, sobran_importe numeric, con_diferencias boolean, ultimo_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT private.cf_ve() THEN RETURN; END IF;
  RETURN QUERY
  WITH fact AS (
    SELECT DISTINCT e.factura_clave AS fc
      FROM public.picking_entregas e
     WHERE e.factura_clave IS NOT NULL AND e.anulado_at IS NULL
  ),
  rec AS (
    SELECT DISTINCT ON (f.fc) f.fc, r.clave, r.proveedor, r.n_factura, r.n_oc, r.fecha_ingreso,
           bool_and(r.fecha_controlada IS NULL) OVER (PARTITION BY f.fc) AS sin_controlar
      FROM fact f
      JOIN public.recepcion_indo r ON private.factura_clave(r.proveedor, r.n_factura) = f.fc
     ORDER BY f.fc, r.fecha_ingreso DESC NULLS LAST, r.clave
  )
  SELECT rec.fc, rec.clave, rec.proveedor, rec.n_factura, rec.n_oc, rec.fecha_ingreso,
         c.id,
         CASE WHEN c.estado = 'terminado' THEN 'terminado'
              WHEN c.id IS NOT NULL AND x.controlados > 0 THEN 'en_curso'
              ELSE 'pendiente' END,
         c.iniciado_nombre, c.iniciado_at, c.terminado_nombre, c.terminado_at,
         x.renglones, x.para_desglosar, x.desglosados, x.controlados,
         x.unidades_picking, x.unidades_contadas, x.importe_picking,
         x.faltan, x.sobran, x.faltan_importe, x.sobran_importe,
         (x.faltan > 0 OR x.sobran > 0), x.ultimo_at
    FROM rec
    LEFT JOIN public.control_fisico c ON c.factura_clave = rec.fc
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS renglones,
             count(*) FILTER (WHERE l.requiere_desglose)::int AS para_desglosar,
             count(*) FILTER (WHERE l.requiere_desglose AND l.contado IS NOT NULL)::int AS desglosados,
             count(*) FILTER (WHERE l.contado IS NOT NULL)::int AS controlados,
             coalesce(sum(l.picking), 0) AS unidades_picking,
             coalesce(sum(l.contado), 0) AS unidades_contadas,
             coalesce(sum(l.picking * coalesce(l.precio, 0)), 0) AS importe_picking,
             coalesce(sum(greatest(l.picking - l.contado, 0)), 0) AS faltan,
             coalesce(sum(greatest(l.contado - l.picking, 0)), 0) AS sobran,
             coalesce(sum(greatest(l.picking - l.contado, 0) * coalesce(l.precio, 0)), 0) AS faltan_importe,
             coalesce(sum(greatest(l.contado - l.picking, 0) * coalesce(l.precio, 0)), 0) AS sobran_importe,
             max(l.actualizado_at) AS ultimo_at
        FROM private.cf_lineas(rec.fc) l
    ) x
   WHERE c.id IS NOT NULL OR rec.sin_controlar
   ORDER BY CASE WHEN c.estado = 'terminado' THEN 1 ELSE 0 END,
            coalesce(c.terminado_at, rec.fecha_ingreso::timestamptz) DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.control_fisico_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_lista() TO authenticated;

-- ---------------------------------------------------------------- detalle
CREATE OR REPLACE FUNCTION public.control_fisico_detalle(p_factura text)
RETURNS TABLE(codigo text, numero text, articulo text, descripcion text, color text, talle text,
              picking numeric, precio numeric, requiere_desglose boolean,
              contado numeric, motivo text, desglose jsonb, actualizado_nombre text, actualizado_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT private.cf_ve() THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM private.cf_lineas(p_factura);
END;
$$;
REVOKE ALL ON FUNCTION public.control_fisico_detalle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_detalle(text) TO authenticated;

-- ---------------------------------------------------------------- guardar un renglón
-- p_contado y p_desglose NULL = sacar lo contado de ese renglón. En renglones 00/U
-- lo contado es la suma del desglose (p_contado se ignora) ([{color, color_desc, talle, cantidad}]).
CREATE OR REPLACE FUNCTION public.control_fisico_guardar(
  p_factura  text,
  p_codigo   text,
  p_articulo text,
  p_color    text,
  p_talle    text,
  p_contado  numeric,
  p_motivo   text DEFAULT NULL,
  p_desglose jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_linea   record;
  v_ctrl    public.control_fisico%ROWTYPE;
  v_contado numeric := p_contado;
  v_des     jsonb := NULL;
  v_el      jsonb;
  v_combos  text[] := '{}';
  v_combo   text;
  v_cant    numeric;
BEGIN
  IF NOT private.cf_cuenta() THEN RAISE EXCEPTION 'Sin permiso para hacer el control físico'; END IF;

  SELECT * INTO v_linea FROM private.cf_lineas(p_factura) l
   WHERE l.codigo = p_codigo AND l.articulo = upper(btrim(p_articulo))
     AND l.color = btrim(coalesce(p_color, '')) AND l.talle = btrim(coalesce(p_talle, ''));
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglón no está en el picking de la factura (¿se anuló el picking?)'; END IF;

  INSERT INTO public.control_fisico (factura_clave, recepcion_clave, iniciado_por, iniciado_nombre)
  VALUES (p_factura,
          (SELECT r.clave FROM public.recepcion_indo r
            WHERE private.factura_clave(r.proveedor, r.n_factura) = p_factura
            ORDER BY r.fecha_ingreso DESC NULLS LAST LIMIT 1),
          auth.uid(), private.cf_mi_nombre())
  ON CONFLICT (factura_clave) DO NOTHING;
  SELECT * INTO v_ctrl FROM public.control_fisico c WHERE c.factura_clave = p_factura FOR UPDATE;
  IF v_ctrl.estado = 'terminado' THEN RAISE EXCEPTION 'Este control físico ya está terminado'; END IF;

  IF v_contado IS NULL AND p_desglose IS NULL THEN
    DELETE FROM public.control_fisico_lineas l
     WHERE l.control_id = v_ctrl.id AND l.codigo = v_linea.codigo AND l.articulo = v_linea.articulo
       AND l.color = v_linea.color AND l.talle = v_linea.talle;
    RETURN;
  END IF;

  IF v_linea.requiere_desglose THEN
    IF p_desglose IS NULL OR jsonb_typeof(p_desglose) <> 'array' THEN
      RAISE EXCEPTION 'Este renglón (color 00 / talle U) se tiene que desglosar por color y talle';
    END IF;
    v_des := '[]'::jsonb;
    v_contado := 0;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_desglose) LOOP
      v_cant := (v_el->>'cantidad')::numeric;
      IF v_cant IS NULL OR v_cant <> trunc(v_cant) OR v_cant < 0 THEN RAISE EXCEPTION 'Cantidad inválida en el desglose'; END IF;
      CONTINUE WHEN v_cant = 0;
      IF btrim(coalesce(v_el->>'color', '')) = '' OR btrim(coalesce(v_el->>'talle', '')) = '' THEN
        RAISE EXCEPTION 'Cada cantidad del desglose lleva color y talle';
      END IF;
      v_combo := upper(btrim(v_el->>'color')) || '|' || upper(btrim(v_el->>'talle'));
      IF v_combo = ANY (v_combos) THEN RAISE EXCEPTION 'Color y talle repetidos en el desglose: %', v_combo; END IF;
      v_combos := v_combos || v_combo;
      v_des := v_des || jsonb_build_object(
        'color', upper(btrim(v_el->>'color')),
        'color_desc', nullif(btrim(coalesce(v_el->>'color_desc', '')), ''),
        'talle', upper(btrim(v_el->>'talle')),
        'cantidad', v_cant);
      v_contado := v_contado + v_cant;
    END LOOP;
  ELSE
    IF p_desglose IS NOT NULL AND jsonb_typeof(p_desglose) = 'array' AND jsonb_array_length(p_desglose) > 0 THEN
      RAISE EXCEPTION 'Este renglón ya tiene color y talle: se cuenta, no se desglosa';
    END IF;
  END IF;

  IF v_contado < 0 OR v_contado <> trunc(v_contado) THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF v_contado < v_linea.picking AND btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Faltan % u.: elegí el motivo', v_linea.picking - v_contado;
  END IF;

  INSERT INTO public.control_fisico_lineas AS l
    (control_id, codigo, articulo, color, talle, contado, motivo, desglose, actualizado_por, actualizado_nombre, actualizado_at)
  VALUES (v_ctrl.id, v_linea.codigo, v_linea.articulo, v_linea.color, v_linea.talle, v_contado,
          CASE WHEN v_contado <> v_linea.picking THEN nullif(btrim(coalesce(p_motivo, '')), '') END,
          v_des, auth.uid(), private.cf_mi_nombre(), now())
  ON CONFLICT (control_id, codigo, articulo, color, talle) DO UPDATE
    SET contado = excluded.contado, motivo = excluded.motivo, desglose = excluded.desglose,
        actualizado_por = excluded.actualizado_por, actualizado_nombre = excluded.actualizado_nombre,
        actualizado_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.control_fisico_guardar(text, text, text, text, text, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_guardar(text, text, text, text, text, numeric, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------- terminar
-- Todo contado → terminado, totales, y «Controlada» en Recepción INDO (siempre;
-- las diferencias quedan en con_diferencias). Devuelve el id para el aviso push.
CREATE OR REPLACE FUNCTION public.control_fisico_terminar(p_factura text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_ctrl public.control_fisico%ROWTYPE;
  t      record;
BEGIN
  IF NOT private.cf_cuenta() THEN RAISE EXCEPTION 'Sin permiso para hacer el control físico'; END IF;
  SELECT * INTO v_ctrl FROM public.control_fisico c WHERE c.factura_clave = p_factura FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Todavía no se contó nada de esta factura'; END IF;
  IF v_ctrl.estado = 'terminado' THEN RAISE EXCEPTION 'Este control físico ya está terminado'; END IF;

  SELECT count(*) AS renglones,
         count(*) FILTER (WHERE l.contado IS NULL) AS sin_contar,
         coalesce(sum(l.picking), 0) AS pk,
         coalesce(sum(l.contado), 0) AS ct,
         coalesce(sum(greatest(l.picking - l.contado, 0)), 0) AS faltan,
         coalesce(sum(greatest(l.contado - l.picking, 0)), 0) AS sobran,
         coalesce(sum(greatest(l.picking - l.contado, 0) * coalesce(l.precio, 0)), 0) AS faltan_imp,
         coalesce(sum(greatest(l.contado - l.picking, 0) * coalesce(l.precio, 0)), 0) AS sobran_imp
    INTO t
    FROM private.cf_lineas(p_factura) l;
  IF t.renglones = 0 THEN RAISE EXCEPTION 'La factura no tiene picking'; END IF;
  IF t.sin_contar > 0 THEN RAISE EXCEPTION 'Faltan % renglón(es) por contar o desglosar', t.sin_contar; END IF;

  UPDATE public.control_fisico c
     SET estado = 'terminado', terminado_por = auth.uid(), terminado_nombre = private.cf_mi_nombre(),
         terminado_at = now(), unidades_picking = t.pk, unidades_contadas = t.ct,
         faltan = t.faltan, sobran = t.sobran, faltan_importe = t.faltan_imp, sobran_importe = t.sobran_imp,
         con_diferencias = (t.faltan > 0 OR t.sobran > 0)
   WHERE c.id = v_ctrl.id;

  -- «Controlada» en Recepción INDO (el trigger recepcion_indo_firma pone quién y cuándo)
  UPDATE public.recepcion_indo r
     SET fecha_controlada = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
   WHERE private.factura_clave(r.proveedor, r.n_factura) = p_factura
     AND r.fecha_controlada IS NULL;

  -- quien lo terminó ya lo sabe: no le aparece en la campana
  INSERT INTO public.control_fisico_vistos (control_id, usuario_id) VALUES (v_ctrl.id, auth.uid())
  ON CONFLICT DO NOTHING;
  RETURN v_ctrl.id;
END;
$$;
REVOKE ALL ON FUNCTION public.control_fisico_terminar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_terminar(text) TO authenticated;

-- ---------------------------------------------------------------- reabrir (solo admin)
CREATE OR REPLACE FUNCTION public.control_fisico_reabrir(p_factura text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT coalesce(private.es_admin(), false) THEN RAISE EXCEPTION 'Solo el administrador puede reabrir un control'; END IF;
  UPDATE public.control_fisico c
     SET estado = 'en_curso', terminado_por = NULL, terminado_nombre = NULL, terminado_at = NULL,
         unidades_picking = NULL, unidades_contadas = NULL, faltan = NULL, sobran = NULL,
         faltan_importe = NULL, sobran_importe = NULL, con_diferencias = NULL, push_at = NULL
   WHERE c.factura_clave = p_factura AND c.estado = 'terminado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese control no está terminado'; END IF;
  UPDATE public.recepcion_indo r SET fecha_controlada = NULL
   WHERE private.factura_clave(r.proveedor, r.n_factura) = p_factura;
  DELETE FROM public.control_fisico_vistos v
   USING public.control_fisico c WHERE c.id = v.control_id AND c.factura_clave = p_factura;
END;
$$;
REVOKE ALL ON FUNCTION public.control_fisico_reabrir(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_reabrir(text) TO authenticated;

-- ---------------------------------------------------------------- estado por fila de Recepción INDO
CREATE OR REPLACE FUNCTION public.control_fisico_estados(p_claves text[])
RETURNS TABLE(clave text, factura_clave text, estado text, renglones integer, controlados integer,
              quien text, con_diferencias boolean, faltan numeric, sobran numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.clave, l.factura_clave, l.estado, l.renglones, l.controlados,
         coalesce(l.terminado_nombre, l.iniciado_nombre), l.con_diferencias, l.faltan, l.sobran
    FROM public.recepcion_indo r
    JOIN public.control_fisico_lista() l ON l.factura_clave = private.factura_clave(r.proveedor, r.n_factura)
   WHERE r.clave = ANY (coalesce(p_claves, '{}'))
$$;
REVOKE ALL ON FUNCTION public.control_fisico_estados(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_estados(text[]) TO authenticated;

-- ---------------------------------------------------------------- avisos
-- Campana: controles terminados en los últimos 3 días que el usuario no abrió
CREATE OR REPLACE FUNCTION public.control_fisico_avisos()
RETURNS TABLE(control_id uuid, factura_clave text, proveedor text, n_factura text,
              terminado_nombre text, terminado_at timestamptz, con_diferencias boolean, faltan numeric, sobran numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, c.factura_clave, r.proveedor, r.n_factura, c.terminado_nombre, c.terminado_at,
         c.con_diferencias, c.faltan, c.sobran
    FROM public.control_fisico c
    LEFT JOIN public.recepcion_indo r ON r.clave = c.recepcion_clave
   WHERE private.cf_cuenta()
     AND c.estado = 'terminado' AND c.terminado_at >= now() - interval '3 days'
     AND NOT EXISTS (SELECT 1 FROM public.control_fisico_vistos v
                      WHERE v.control_id = c.id AND v.usuario_id = auth.uid())
   ORDER BY c.terminado_at
$$;
REVOKE ALL ON FUNCTION public.control_fisico_avisos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_avisos() TO authenticated;

CREATE OR REPLACE FUNCTION public.control_fisico_visto(p_factura text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.control_fisico_vistos (control_id, usuario_id)
  SELECT c.id, auth.uid() FROM public.control_fisico c
   WHERE c.factura_clave = p_factura AND c.estado = 'terminado' AND auth.uid() IS NOT NULL
  ON CONFLICT DO NOTHING
$$;
REVOKE ALL ON FUNCTION public.control_fisico_visto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_fisico_visto(text) TO authenticated;

-- Push (api/push.ts?tipo=control_fisico, con service role): rol deposito, legajos
-- de Depósito Indo y admins; menos quien lo terminó. Reclama el aviso (uno solo).
CREATE OR REPLACE FUNCTION public.control_fisico_reclamar_push(p_control uuid, p_usuario uuid)
RETURNS TABLE(usuario_id uuid, proveedor text, n_factura text, factura_clave text,
              terminado_nombre text, con_diferencias boolean, faltan numeric, sobran numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_ctrl public.control_fisico%ROWTYPE;
BEGIN
  UPDATE public.control_fisico c SET push_at = now()
   WHERE c.id = p_control AND c.estado = 'terminado' AND c.push_at IS NULL AND c.terminado_por = p_usuario
  RETURNING * INTO v_ctrl;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  WITH dest AS (
    SELECT ur.usuario_id AS id FROM public.usuario_roles ur WHERE ur.rol_codigo = 'deposito'
    UNION SELECT u.id FROM public.usuarios u WHERE u.es_admin
    UNION SELECT u.id FROM public.usuarios u JOIN public.empleados e ON e.legajo = u.legajo
           WHERE e.ubicacion = 'DEPOSITO INDO' AND e.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')
  )
  SELECT d.id, r.proveedor, r.n_factura, v_ctrl.factura_clave, v_ctrl.terminado_nombre,
         v_ctrl.con_diferencias, v_ctrl.faltan, v_ctrl.sobran
    FROM dest d
    LEFT JOIN public.recepcion_indo r ON r.clave = v_ctrl.recepcion_clave
   WHERE d.id IS DISTINCT FROM p_usuario;
END;
$$;
REVOKE ALL ON FUNCTION public.control_fisico_reclamar_push(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_fisico_reclamar_push(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------- precio de compra en Picking
-- Precio unitario sin IVA de cada renglón de la OC (promedio ponderado si se repite)
CREATE OR REPLACE FUNCTION public.picking_precios(p_codigo text)
RETURNS TABLE(articulo text, color text, talle text, precio numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT upper(btrim(i.articulo)), btrim(coalesce(i.color, '')), btrim(coalesce(i.talle, '')),
         round(coalesce(sum(i.precio * i.cantidad) / nullif(sum(i.cantidad), 0), max(i.precio)), 2)
    FROM public.pedidos_compra_items i
   WHERE i.codigo = p_codigo AND coalesce(btrim(i.articulo), '') <> ''
     AND (private.tengo_permiso('picking.view') OR private.cf_ve())
   GROUP BY 1, 2, 3
$$;
REVOKE ALL ON FUNCTION public.picking_precios(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picking_precios(text) TO authenticated;

-- ---------------------------------------------------------------- vistas de Dragon habilitadas
UPDATE public.config_app ca
   SET valor = ca.valor || x.nuevas
  FROM (
    SELECT jsonb_agg(v) AS nuevas
      FROM (VALUES
        (jsonb_build_object('label', 'Colores Indo (Dragon)', 'vista', 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_COLORES_INDOD')),
        (jsonb_build_object('label', 'Talles Indo (Dragon)', 'vista', 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_TALLES_INDOD'))
      ) t(v)
     WHERE NOT EXISTS (SELECT 1 FROM public.config_app c2, jsonb_array_elements(c2.valor) e
                        WHERE c2.clave = 'sql_vistas' AND e->>'vista' = t.v->>'vista')
  ) x
 WHERE ca.clave = 'sql_vistas' AND x.nuevas IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
