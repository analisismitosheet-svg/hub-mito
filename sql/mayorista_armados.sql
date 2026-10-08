-- ============================================================================
-- ARMADO DE PEDIDOS  (Mayorista pide · Mi repo del piso lo arma)
--
-- En Pedidos de venta (Mayorista) se pide el armado de uno o varios pedidos,
-- con prioridad (urgente / normal / baja). La tarea entra a Mi repo de TODOS
-- los legajos del piso: suena el celular, vibran y aparece la notificación
-- hasta que alguien toca "Acepto".
--
-- El primero que acepta se lo queda (carrera resuelta en la base:
--   update ... set estado='aceptado' where estado='pendiente').
-- A medida que el legajo escanea los artículos (o los tilda con la ✓),
-- el avance se guarda en mayorista_armados_items y Pedidos de venta lo
-- muestra en verde en tiempo real.
--
-- Tablas NUEVAS (no toca ninguna existente):
--   mayorista_armados         una fila por pedido pedido a armar
--   mayorista_armados_items   copia de los renglones del pedido, con el avance
--
-- Funciones NUEVAS:
--   pedir_armado(codigos[], prioridad, obs)   el mayorista lo pide (bulk OK)
--   armado_aceptar(id, legajo, nombre)        gana el primero (where pendiente)
--   armado_escanear(id, codigo)               +1 unidad (igual que escanear_codigo)
--   armado_marcar_item(id, linea)             tilde manual: marca la línea entera
--   armado_deshacer(id, linea)                -1 unidad
--   armado_finalizar(id)                      cierra; lo que falte queda faltante
--
-- Ejecutar en Supabase SQL Editor, o:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/mayorista_armados.sql
-- Idempotente.
-- ============================================================================

-- ----------------------------------------------------- -----------------------
-- 1. Tablas
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mayorista_armados (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_codigo    text NOT NULL REFERENCES public.pedidos_venta (codigo) ON DELETE CASCADE,
  pedido_numero    integer,
  cliente          text,
  cliente_nombre   text,
  prioridad        text NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('urgente', 'normal', 'baja')),
  estado           text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptado', 'hecho')),
  obs              text,
  creado_at        timestamptz NOT NULL DEFAULT now(),
  creado_por       uuid DEFAULT auth.uid(),
  aceptado_at      timestamptz,
  aceptado_por     uuid,
  aceptado_legajo  text,
  aceptado_nombre  text,
  hecho_at         timestamptz,
  faltantes        integer NOT NULL DEFAULT 0
);

-- Un pedido sólo puede tener UN armado abierto (pendiente o en curso) a la vez
CREATE UNIQUE INDEX IF NOT EXISTS mayorista_armados_activo_uq
  ON public.mayorista_armados (pedido_codigo)
  WHERE estado IN ('pendiente', 'aceptado');

CREATE INDEX IF NOT EXISTS mayorista_armados_estado_idx
  ON public.mayorista_armados (estado, creado_at DESC);

CREATE TABLE IF NOT EXISTS public.mayorista_armados_items (
  armado_id   uuid NOT NULL REFERENCES public.mayorista_armados (id) ON DELETE CASCADE,
  linea       integer NOT NULL,
  articulo    text,
  descripcion text,
  color       text,
  talle       text,
  cantidad    integer NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  escaneadas  integer NOT NULL DEFAULT 0 CHECK (escaneadas >= 0 AND escaneadas <= cantidad),
  estado      text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'hecho', 'faltante')),
  PRIMARY KEY (armado_id, linea)
);

CREATE INDEX IF NOT EXISTS mayorista_armados_items_armado_idx
  ON public.mayorista_armados_items (armado_id);

-- ----------------------------------------------------- -----------------------
-- 2. RLS: el piso y el mayorista LEEN; todo lo demás se hace por funciones
-- --------------------------------------------------------------------------
ALTER TABLE public.mayorista_armados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mayorista_armados_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mayorista_armados, public.mayorista_armados_items FROM anon;
GRANT SELECT ON public.mayorista_armados, public.mayorista_armados_items TO authenticated;

-- Quien puede mirar armados: mayorista (pide), piso (arma) y admin.
DROP POLICY IF EXISTS mayorista_armados_ver ON public.mayorista_armados;
CREATE POLICY mayorista_armados_ver ON public.mayorista_armados
  FOR SELECT TO authenticated
  USING (
    private.tengo_permiso('pedidos_venta.view')
    OR private.tengo_permiso('mayorista.repos_piso')

  );

DROP POLICY IF EXISTS mayorista_armados_items_ver ON public.mayorista_armados_items;
CREATE POLICY mayorista_armados_items_ver ON public.mayorista_armados_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mayorista_armados a
      WHERE a.id = mayorista_armados_items.armado_id
        AND (
          private.tengo_permiso('pedidos_venta.view')
          OR private.tengo_permiso('mayorista.repos_piso')
      
        )
    )
  );

-- ----------------------------------------------------- -----------------------
-- 3. Helper: ¿ya se marcaron todos los artículos? El armado pasa a 'hecho'
--    y el mayorista lo ve en verde en Pedidos de venta.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.armado_cerrar_si_listo(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pend integer;
  v_fal  integer;
BEGIN
  SELECT count(*) FILTER (WHERE i.estado = 'pendiente'),
         count(*) FILTER (WHERE i.estado = 'faltante')
    INTO v_pend, v_fal
    FROM public.mayorista_armados_items i
   WHERE i.armado_id = p_id;

  IF v_pend > 0 THEN
    -- si se reabrió (hubo un deshacer), vuelve a en curso
    UPDATE public.mayorista_armados
       SET estado = CASE WHEN estado = 'hecho' THEN 'aceptado' ELSE estado END,
           hecho_at = CASE WHEN estado = 'hecho' THEN NULL ELSE hecho_at END,
           faltantes = CASE WHEN estado = 'hecho' THEN 0 ELSE faltantes END
     WHERE id = p_id AND estado = 'hecho' AND v_fal = 0;
    RETURN;
  END IF;

  UPDATE public.mayorista_armados
     SET estado = 'hecho',
         hecho_at = coalesce(hecho_at, now()),
         faltantes = v_fal
   WHERE id = p_id AND estado = 'aceptado';
END;
$$;

-- ----------------------------------------------------- -----------------------
-- 4. El mayorista pide el armado de uno o varios pedidos
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pedir_armado(
  p_codigos   text[],
  p_prioridad text DEFAULT 'normal',
  p_obs       text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cod  text;
  v_ped  public.pedidos_venta%ROWTYPE;
  v_id   uuid;
  v_n    integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Sin permiso para pedir el armado de pedidos' USING ERRCODE = '42501';
  END IF;
  IF p_prioridad IS NULL OR p_prioridad NOT IN ('urgente', 'normal', 'baja') THEN
    RAISE EXCEPTION 'Prioridad inválida: urgente, normal o baja' USING ERRCODE = '22023';
  END IF;
  IF p_codigos IS NULL OR coalesce(array_length(p_codigos, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Ningún pedido seleccionado' USING ERRCODE = '22023';
  END IF;
  IF coalesce(array_length(p_codigos, 1), 0) > 100 THEN
    RAISE EXCEPTION 'Máximo 100 pedidos por pedido de armado' USING ERRCODE = '22023';
  END IF;

  FOREACH v_cod IN ARRAY p_codigos LOOP
    SELECT * INTO v_ped FROM public.pedidos_venta WHERE codigo = trim(v_cod);
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_ped.anulado THEN CONTINUE; END IF;
    -- Sin renglones con cantidad no hay nada que armar
    IF NOT EXISTS (
      SELECT 1 FROM public.pedidos_venta_items i
       WHERE i.codigo = v_ped.codigo AND coalesce(round(i.cantidad), 0) > 0
    ) THEN
      CONTINUE;
    END IF;
    -- Ya está pedido a armar y todavía no se cerró: no se duplica
    IF EXISTS (
      SELECT 1 FROM public.mayorista_armados a
       WHERE a.pedido_codigo = v_ped.codigo AND a.estado IN ('pendiente', 'aceptado')
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.mayorista_armados
      (pedido_codigo, pedido_numero, cliente, cliente_nombre, prioridad, obs, creado_por)
    VALUES
      (v_ped.codigo, v_ped.numero, v_ped.cliente, v_ped.cliente_nombre,
       p_prioridad, nullif(trim(coalesce(p_obs, '')), ''), auth.uid())
    RETURNING id INTO v_id;

    INSERT INTO public.mayorista_armados_items
      (armado_id, linea, articulo, descripcion, color, talle, cantidad)
    SELECT v_id,
           i.linea,
           nullif(upper(regexp_replace(coalesce(i.articulo, ''), '\s', '', 'g')), ''),
           i.descripcion,
           i.color,
           i.talle,
           greatest(round(i.cantidad)::integer, 0)
      FROM public.pedidos_venta_items i
     WHERE i.codigo = v_ped.codigo
       AND coalesce(round(i.cantidad), 0) > 0
     ORDER BY i.linea;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

-- ----------------------------------------------------- -----------------------
-- 5. El legajo lo acepta. Carrera: gana el primero (where estado='pendiente'),
--    si otro lo tomó antes devuelve false.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.armado_aceptar(
  p_id     uuid,
  p_legajo text DEFAULT NULL,
  p_nombre text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (
    private.tengo_permiso('pedidos_venta.view')
    OR private.tengo_permiso('mayorista.repos_piso')

  ) THEN
    RAISE EXCEPTION 'Sin permiso para tomar armados' USING ERRCODE = '42501';
  END IF;

  UPDATE public.mayorista_armados
     SET estado = 'aceptado',
         aceptado_at = now(),
         aceptado_por = auth.uid(),
         aceptado_legajo = nullif(trim(coalesce(p_legajo, '')), ''),
         aceptado_nombre = nullif(trim(coalesce(p_nombre, '')), '')
   WHERE id = p_id
     AND estado = 'pendiente';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN v_n > 0;
END;
$$;

-- ----------------------------------------------------- -----------------------
-- 6. Escaneo: suma UNA unidad al primer renglón pendiente con ese código.
--    Misma idea que escanear_codigo() de los repos (sql/empleados_piso_seguridad_1.sql).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.armado_escanear(p_id uuid, p_codigo text)
RETURNS TABLE (item_linea integer, item_escaneadas integer, item_cantidad integer, item_estado text, item_articulo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cod   text := upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  v_acept uuid;
  v_est   text;
  v_linea integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;
  IF v_cod = '' THEN
    RAISE EXCEPTION 'Código vacío' USING ERRCODE = '22023';
  END IF;

  SELECT a.aceptado_por, a.estado INTO v_acept, v_est
    FROM public.mayorista_armados a WHERE a.id = p_id;
  IF v_acept IS NULL THEN
    RAISE EXCEPTION 'Ese armado no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_acept <> auth.uid() AND NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Ese armado lo está haciendo otro legajo' USING ERRCODE = '42501';
  END IF;
  IF v_est <> 'aceptado' THEN
    RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
  END IF;

  SELECT i.linea INTO v_linea
    FROM public.mayorista_armados_items i
   WHERE i.armado_id = p_id
     AND i.estado <> 'faltante'
     AND i.escaneadas < i.cantidad
     AND upper(regexp_replace(coalesce(i.articulo, ''), '\s', '', 'g')) = v_cod
   ORDER BY i.linea
   LIMIT 1
   FOR UPDATE;

  IF v_linea IS NULL THEN
    RAISE EXCEPTION '% no está pendiente en este armado', v_cod USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.mayorista_armados_items i
     SET escaneadas = least(i.escaneadas + 1, i.cantidad),
         estado = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN 'hecho' ELSE i.estado END
   WHERE i.armado_id = p_id AND i.linea = v_linea
   RETURNING i.linea, i.escaneadas, i.cantidad, i.estado, i.articulo;

  PERFORM private.armado_cerrar_si_listo(p_id);
END;
$$;

-- ----------------------------------------------------- -----------------------
-- 7. Tilde manual al lado del artículo: la cámara no lo leyó y no se quiere
--    escribir el código. Marca la línea COMPLETA.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.armado_marcar_item(p_id uuid, p_linea integer)
RETURNS TABLE (item_linea integer, item_escaneadas integer, item_cantidad integer, item_estado text, item_articulo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acept uuid;
  v_est   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT a.aceptado_por, a.estado INTO v_acept, v_est
    FROM public.mayorista_armados a WHERE a.id = p_id FOR UPDATE;
  IF v_acept IS NULL THEN
    RAISE EXCEPTION 'Ese armado no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_acept <> auth.uid() AND NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Ese armado lo está haciendo otro legajo' USING ERRCODE = '42501';
  END IF;
  IF v_est <> 'aceptado' THEN
    RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.mayorista_armados_items i
     SET escaneadas = i.cantidad,
         estado = 'hecho'
   WHERE i.armado_id = p_id
     AND i.linea = p_linea
     AND i.estado = 'pendiente'
   RETURNING i.linea, i.escaneadas, i.cantidad, i.estado, i.articulo;

  PERFORM private.armado_cerrar_si_listo(p_id);
END;
$$;

-- ----------------------------------------------------- -----------------------
-- 8. Deshacer: resta UNA unidad (el botón "↺ Deshacer" del piso).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.armado_deshacer(p_id uuid, p_linea integer)
RETURNS TABLE (item_linea integer, item_escaneadas integer, item_cantidad integer, item_estado text, item_articulo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acept uuid;
  v_est   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT a.aceptado_por, a.estado INTO v_acept, v_est
    FROM public.mayorista_armados a WHERE a.id = p_id;
  IF v_acept IS NULL THEN
    RAISE EXCEPTION 'Ese armado no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_acept <> auth.uid() AND NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Ese armado lo está haciendo otro legajo' USING ERRCODE = '42501';
  END IF;
  IF v_est <> 'aceptado' THEN
    RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  UPDATE public.mayorista_armados_items i
     SET escaneadas = greatest(i.escaneadas - 1, 0),
         estado = CASE
                    WHEN i.escaneadas - 1 < i.cantidad THEN 'pendiente'
                    ELSE i.estado
                  END
   WHERE i.armado_id = p_id
     AND i.linea = p_linea
     AND i.escaneadas > 0
     AND i.estado <> 'faltante'
   RETURNING i.linea, i.escaneadas, i.cantidad, i.estado, i.articulo;

  PERFORM private.armado_cerrar_si_listo(p_id);
END;
$$;

-- ----------------------------------------------------- -----------------------
-- 9. Finalizar: lo que quedó sin escaneedar pasa a faltante (igual que el
--    "Finalizar repo" de piso_finalizar_faltantes.sql) y se guarda el tiempo.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.armado_finalizar(p_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acept uuid;
  v_est   text;
  v_fal   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT a.aceptado_por, a.estado INTO v_acept, v_est
    FROM public.mayorista_armados a WHERE a.id = p_id FOR UPDATE;
  IF v_acept IS NULL THEN
    RAISE EXCEPTION 'Ese armado no existe' USING ERRCODE = 'P0002';
  END IF;
  IF v_acept <> auth.uid() AND NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Ese armado lo está haciendo otro legajo' USING ERRCODE = '42501';
  END IF;
  IF v_est <> 'aceptado' THEN
    RAISE EXCEPTION 'Ese armado ya no está en curso' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.mayorista_armados_items i
     SET escaneadas = coalesce(i.escaneadas, 0),
         estado = 'faltante'
   WHERE i.armado_id = p_id
     AND i.estado = 'pendiente';
  GET DIAGNOSTICS v_fal = ROW_COUNT;

  UPDATE public.mayorista_armados
     SET estado = 'hecho',
         hecho_at = now(),
         faltantes = v_fal
   WHERE id = p_id;

  RETURN v_fal;
END;
$$;

-- ----------------------------------------------------- -----------------------
-- 10. Permisos de ejecución (lo usa el piso y el mayorista autenticados)
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pedir_armado(text[], text, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_aceptar(uuid, text, text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_escanear(uuid, text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_marcar_item(uuid, integer)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_deshacer(uuid, integer)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.armado_finalizar(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.armado_cerrar_si_listo(uuid)             FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.pedir_armado(text[], text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_aceptar(uuid, text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_escanear(uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_marcar_item(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_deshacer(uuid, integer)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.armado_finalizar(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION private.armado_cerrar_si_listo(uuid)     TO authenticated;
