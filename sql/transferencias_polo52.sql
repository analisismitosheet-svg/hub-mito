-- ============================================================================
-- Transferencias de Polo 52: el mismo proceso que Depósito Indo (25/11/2026).
--
-- Polo 52 → «Transferencias Polo 52» (/polo52/transferencias) muestra los lotes de
-- 30 días con renglones que SALEN de Polo 52 (origen POLO52 / POLO52D / POLO5),
-- con estadísticas, «Por local», escaneo, ✓ Hecho / ✕ Faltante, igual que
-- Repos Depósito con Indo (sql/deposito_transferencias.sql y
-- sql/transferencias_deposito_escaneo.sql).
--
-- Las funciones de Indo suman un último parámetro p_deposito ('INDO' por
-- defecto, así lo de Indo sigue igual sin cambiar nada):
--   deposito_transferencias(p_deposito)
--   transferencia_marcar_deposito(ids, estado, p_deposito)
--   transferencia_escanear_deposito(lote, destino, codigo, p_deposito)
--   transferencia_desescanear_deposito(item, p_deposito)
-- private.locales_deposito(p_deposito): con qué orígenes puede trabajar el usuario.
--   INDO   → private.mis_locales_deposito() (lo de siempre)
--   POLO52 → admin o permiso polo52.transferencias.view
-- Ejecutar DESPUÉS de sql/transferencias_deposito_escaneo.sql. Idempotente.
-- ============================================================================

BEGIN;

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('polo52.transferencias.view', 'polo52', 'transferencias.view', 'Ver transferencias de Polo 52', 840),
  ('polo52.transferencias.mark', 'polo52', 'transferencias.mark', 'Marcar transferencias de Polo 52', 841)
ON CONFLICT (clave) DO NOTHING;

-- ---- Orígenes con los que trabaja el usuario en cada depósito ----
CREATE OR REPLACE FUNCTION private.locales_deposito(p_deposito text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE upper(coalesce(p_deposito, 'INDO'))
    WHEN 'POLO52' THEN
      CASE WHEN private.es_admin() OR private.tiene_permiso('polo52.transferencias.view')
        THEN (SELECT array_agg(DISTINCT x) FROM unnest(private.origenes_de('POLO52') || ARRAY['POLO52', 'POLO52D', 'POLO 52']) x)
        ELSE '{}'::text[]
      END
    WHEN 'INDO' THEN private.mis_locales_deposito()
    ELSE '{}'::text[]
  END
$$;
REVOKE ALL ON FUNCTION private.locales_deposito(text) FROM anon, public;

-- ---- Lotes con renglones que salen del depósito (30 días) ----
DROP FUNCTION IF EXISTS public.deposito_transferencias();
DROP FUNCTION IF EXISTS public.deposito_transferencias(text);
CREATE FUNCTION public.deposito_transferencias(p_deposito text DEFAULT 'INDO')
RETURNS TABLE(id uuid, lote_id uuid, lote_nombre text, lote_motivo text, lote_creado timestamptz,
              destino text, articulo text, descripcion text, color text, talle text, cantidad integer,
              estado text, hecho_at timestamptz, hecho_por uuid, hecho_por_nombre text, hecho_por_legajo text,
              escaneadas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.locales_deposito(p_deposito);
BEGIN
  IF cardinality(v_locs) = 0 THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.id, l.id, l.nombre, l.motivo, l.created_at,
         i.destino, i.articulo, i.descripcion, i.color, i.talle, i.cantidad,
         coalesce(i.estado, 'pendiente'), i.hecho_at, i.hecho_por,
         coalesce(e.nombre, u.nombre, u.email), u.legajo, coalesce(es.escaneadas, 0)
    FROM public.transfer_lotes l
    JOIN public.transfer_items i ON i.lote_id = l.id
    LEFT JOIN public.transfer_escaneos_deposito es ON es.item_id = i.id
    LEFT JOIN public.usuarios u ON u.id = i.hecho_por
    LEFT JOIN LATERAL (
      SELECT em.nombre FROM public.empleados em
       WHERE u.legajo IS NOT NULL AND em.legajo = u.legajo
       ORDER BY (em.estado_legajo IN ('NOMINA ACTIVA', 'PLANES ACTIVOS')) DESC
       LIMIT 1
    ) e ON true
   WHERE l.created_at >= now() - interval '30 days'
     AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs)
   ORDER BY l.created_at DESC, i.orden;
END;
$$;

-- ---- Marcar a mano (✓ / ✕ / Deshacer) ----
DROP FUNCTION IF EXISTS public.transferencia_marcar_deposito(uuid[], text);
DROP FUNCTION IF EXISTS public.transferencia_marcar_deposito(uuid[], text, text);
CREATE FUNCTION public.transferencia_marcar_deposito(p_ids uuid[], p_estado text, p_deposito text DEFAULT 'INDO')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.locales_deposito(p_deposito);
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
    DELETE FROM public.transfer_escaneos_deposito e
     WHERE e.item_id = ANY(p_ids)
       AND EXISTS (SELECT 1 FROM public.transfer_items i WHERE i.id = e.item_id AND upper(trim(coalesce(i.origen, ''))) = ANY(v_locs));
  END IF;
  RETURN v_n;
END;
$$;

-- ---- Escanear 1 unidad en el local abierto ----
DROP FUNCTION IF EXISTS public.transferencia_escanear_deposito(uuid, text, text);
DROP FUNCTION IF EXISTS public.transferencia_escanear_deposito(uuid, text, text, text);
CREATE FUNCTION public.transferencia_escanear_deposito(p_lote uuid, p_destino text, p_codigo text, p_deposito text DEFAULT 'INDO')
RETURNS TABLE(item_id uuid, articulo text, color text, talle text, escaneadas integer, cantidad integer, estado text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.locales_deposito(p_deposito);
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

-- ---- Deshacer 1 unidad ----
DROP FUNCTION IF EXISTS public.transferencia_desescanear_deposito(uuid);
DROP FUNCTION IF EXISTS public.transferencia_desescanear_deposito(uuid, text);
CREATE FUNCTION public.transferencia_desescanear_deposito(p_item uuid, p_deposito text DEFAULT 'INDO')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.locales_deposito(p_deposito);
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

REVOKE ALL ON FUNCTION public.deposito_transferencias(text) FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencia_marcar_deposito(uuid[], text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencia_escanear_deposito(uuid, text, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.transferencia_desescanear_deposito(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.deposito_transferencias(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_marcar_deposito(uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_escanear_deposito(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_desescanear_deposito(uuid, text) TO authenticated;

COMMIT;

-- ---- Mi repo de Polo 52 (25/11/2026): renglones de 7 días, pendientes + marcados hoy ----
-- Igual que transferencias_deposito_items() de Indo (sql/transferencias_deposito_escaneo.sql),
-- con p_deposito ('INDO' por defecto). Lo usa TransferenciasDeposito en /polo52/mi-repo.
DROP FUNCTION IF EXISTS public.transferencias_deposito_items();
DROP FUNCTION IF EXISTS public.transferencias_deposito_items(text);
CREATE FUNCTION public.transferencias_deposito_items(p_deposito text DEFAULT 'INDO')
RETURNS TABLE(id uuid, lote_id uuid, lote_nombre text, lote_creado timestamptz, origen text, destino text,
              articulo text, descripcion text, color text, talle text, cantidad integer, estado text, hecho_at timestamptz,
              escaneadas integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_locs text[] := private.locales_deposito(p_deposito);
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
REVOKE ALL ON FUNCTION public.transferencias_deposito_items(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.transferencias_deposito_items(text) TO authenticated;

-- ---- Rol polo52 (25/11/2026, lo pidió el usuario): ve y marca Transferencias y Mi repo de Polo 52 ----
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'polo52', p.clave
  FROM (VALUES ('polo52.transferencias.view'), ('polo52.transferencias.mark')) AS p(clave)
 WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = 'polo52' AND permiso_clave = p.clave);
