-- ============================================================================
-- Transferencias de Depósito Indo: escaneo por unidad (borrador Mapeo de cajas).
-- Ejecutar DESPUÉS de sql/transferencias_deposito.sql. Idempotente.
--
-- Igual que Mi repo del mayorista (public.escanear_codigo): en el local abierto se
-- escanea prenda por prenda; cada lectura suma 1 al renglón pendiente del mismo
-- artículo + color + talle, y cuando llega a la cantidad queda «hecho».
-- El conteo vive en una tabla aparte para no tocar transfer_items (la usan
-- Transferencias y los locales): transfer_escaneos_deposito.
--
-- transferencia_escanear_deposito(lote, destino, codigo)  suma 1 unidad.
-- transferencia_desescanear_deposito(item)                resta 1 (deshacer).
-- transferencias_deposito_items()                         ahora devuelve `escaneadas`.
-- transferencia_marcar_deposito(ids, estado)              «pendiente» también borra el conteo.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.transfer_escaneos_deposito (
  item_id     uuid PRIMARY KEY REFERENCES public.transfer_items(id) ON DELETE CASCADE,
  escaneadas  integer NOT NULL DEFAULT 0 CHECK (escaneadas >= 0),
  updated_por uuid DEFAULT auth.uid(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.transfer_escaneos_deposito ENABLE ROW LEVEL SECURITY;
-- Solo por las funciones de abajo
REVOKE ALL ON public.transfer_escaneos_deposito FROM anon, authenticated;

-- ---- Renglones (con lo escaneado) ----
DROP FUNCTION IF EXISTS public.transferencias_deposito_items();
CREATE FUNCTION public.transferencias_deposito_items()
RETURNS TABLE(id uuid, lote_id uuid, lote_nombre text, lote_creado timestamptz, origen text, destino text,
              articulo text, descripcion text, color text, talle text, cantidad integer, estado text, hecho_at timestamptz,
              escaneadas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.mis_locales_deposito();
BEGIN
  IF cardinality(v_locs) = 0 THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.id, l.id, l.nombre, l.created_at, i.origen, i.destino, i.articulo, i.descripcion, i.color, i.talle,
         i.cantidad, coalesce(i.estado, 'pendiente'), i.hecho_at, coalesce(e.escaneadas, 0)
    FROM public.transfer_lotes l
    JOIN public.transfer_items i ON i.lote_id = l.id
    LEFT JOIN public.transfer_escaneos_deposito e ON e.item_id = i.id
   WHERE l.created_at >= now() - interval '7 days'
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
     AND (coalesce(i.estado, 'pendiente') = 'pendiente' OR i.hecho_at >= date_trunc('day', now() AT TIME ZONE 'America/Argentina/Cordoba') AT TIME ZONE 'America/Argentina/Cordoba')
   ORDER BY l.created_at, i.destino, i.articulo, i.color, i.talle;
END;
$$;

-- ---- Escanear 1 unidad en el local abierto ----
DROP FUNCTION IF EXISTS public.transferencia_escanear_deposito(uuid, text, text);
CREATE FUNCTION public.transferencia_escanear_deposito(p_lote uuid, p_destino text, p_codigo text)
RETURNS TABLE(item_id uuid, articulo text, color text, talle text, escaneadas integer, cantidad integer, estado text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.mis_locales_deposito();
  v_cb   record;
  v_id   uuid;
  v_cant integer;
  v_esc  integer;
  v_desc text;
BEGIN
  IF cardinality(v_locs) = 0 THEN RAISE EXCEPTION 'No autorizado'; END IF;
  v_cb := private.parsear_codigo_barras(p_codigo);
  IF coalesce(v_cb.codigo, '') = '' THEN
    RAISE EXCEPTION 'Código vacío' USING ERRCODE = '22023';
  END IF;

  -- El renglón pendiente de ese artículo/color/talle en este local (primero el que ya se empezó)
  SELECT i.id, i.cantidad, coalesce(e.escaneadas, 0) INTO v_id, v_cant, v_esc
    FROM public.transfer_items i
    LEFT JOIN public.transfer_escaneos_deposito e ON e.item_id = i.id
   WHERE i.lote_id = p_lote
     AND upper(trim(coalesce(i.destino, ''))) = upper(trim(coalesce(p_destino, '')))
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
     AND upper(regexp_replace(coalesce(i.articulo, ''), '\s', '', 'g')) = v_cb.codigo
     AND (v_cb.color IS NULL OR private.mismo_color(i.color, v_cb.color))
     AND (v_cb.talle IS NULL OR upper(trim(coalesce(i.talle, ''))) = v_cb.talle)
     AND coalesce(i.estado, 'pendiente') = 'pendiente'
     AND coalesce(e.escaneadas, 0) < i.cantidad
   ORDER BY coalesce(e.escaneadas, 0) DESC, i.id
   LIMIT 1
   FOR UPDATE OF i;

  IF v_id IS NULL THEN
    v_desc := v_cb.codigo
      || CASE WHEN v_cb.color IS NOT NULL THEN ' color ' || v_cb.color ELSE '' END
      || CASE WHEN v_cb.talle IS NOT NULL THEN ' talle ' || v_cb.talle ELSE '' END;
    RAISE EXCEPTION '% no está pendiente para %', v_desc, p_destino USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.transfer_escaneos_deposito AS e (item_id, escaneadas)
  VALUES (v_id, 1)
  ON CONFLICT (item_id) DO UPDATE SET escaneadas = e.escaneadas + 1, updated_por = auth.uid(), updated_at = now();
  v_esc := v_esc + 1;

  -- Completo: queda hecho (igual que el ✓ manual)
  IF v_esc >= v_cant THEN
    UPDATE public.transfer_items i
       SET estado = 'hecho', hecho = true, hecho_at = now(), hecho_por = auth.uid()
     WHERE i.id = v_id;
  END IF;

  RETURN QUERY
  SELECT i.id, i.articulo, i.color, i.talle, v_esc, i.cantidad, coalesce(i.estado, 'pendiente')
    FROM public.transfer_items i WHERE i.id = v_id;
END;
$$;

-- ---- Deshacer 1 unidad (si estaba completo, vuelve a pendiente) ----
DROP FUNCTION IF EXISTS public.transferencia_desescanear_deposito(uuid);
CREATE FUNCTION public.transferencia_desescanear_deposito(p_item uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.mis_locales_deposito();
  v_esc  integer;
BEGIN
  IF cardinality(v_locs) = 0 THEN RAISE EXCEPTION 'No autorizado'; END IF;
  PERFORM 1 FROM public.transfer_items i
   WHERE i.id = p_item AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No autorizado'; END IF;

  UPDATE public.transfer_escaneos_deposito e
     SET escaneadas = greatest(e.escaneadas - 1, 0), updated_por = auth.uid(), updated_at = now()
   WHERE e.item_id = p_item
  RETURNING e.escaneadas INTO v_esc;

  UPDATE public.transfer_items i
     SET estado = 'pendiente', hecho = false, hecho_at = NULL, hecho_por = NULL
   WHERE i.id = p_item AND coalesce(i.estado, 'pendiente') = 'hecho';
  RETURN coalesce(v_esc, 0);
END;
$$;

-- ---- Marcar a mano: «pendiente» (Deshacer) también borra lo escaneado ----
CREATE OR REPLACE FUNCTION public.transferencia_marcar_deposito(p_ids uuid[], p_estado text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.mis_locales_deposito();
  v_n integer;
BEGIN
  IF cardinality(v_locs) = 0 THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF p_estado NOT IN ('pendiente', 'hecho', 'faltante') THEN RAISE EXCEPTION 'Estado inválido'; END IF;
  UPDATE public.transfer_items i
     SET estado = p_estado,
         hecho = (p_estado = 'hecho'),
         hecho_at = CASE WHEN p_estado = 'pendiente' THEN NULL ELSE now() END,
         hecho_por = CASE WHEN p_estado = 'pendiente' THEN NULL ELSE auth.uid() END
   WHERE i.id = ANY(p_ids)
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF p_estado = 'pendiente' THEN
    DELETE FROM public.transfer_escaneos_deposito e WHERE e.item_id = ANY(p_ids);
  END IF;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.transferencias_deposito_items() FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencia_escanear_deposito(uuid, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencia_desescanear_deposito(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencia_marcar_deposito(uuid[], text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.transferencias_deposito_items() TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_escanear_deposito(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_desescanear_deposito(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_marcar_deposito(uuid[], text) TO authenticated;

COMMIT;
