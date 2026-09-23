-- =====================================================
-- ESCANEO CON EL CÓDIGO DE BARRAS DE LA ETIQUETA  (sigue a piso_contador_backfill.sql)
--
-- Formatos que lee el lector:
--   CODIGO!COLOR!TALLE     ej. zh000200!02!xl
--   CODIGO%COLORTALLE      ej. zh000200%02xl   (color = 2 caracteres después del %)
--   CODIGO                 ej. zh000200        (sin color/talle: como antes)
--
-- Con color y talle, el escaneo suma al artículo EXACTO (mismo código, color
-- y talle). Colores numéricos se comparan sin ceros a la izquierda (2 = 02).
-- =====================================================

BEGIN;

-- Separa el código de barras en (codigo, color, talle). color/talle null si no vienen.
CREATE OR REPLACE FUNCTION private.parsear_codigo_barras(p_bruto text, OUT codigo text, OUT color text, OUT talle text)
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_raw text := upper(regexp_replace(coalesce(p_bruto, ''), '\s', '', 'g'));
  v_partes text[] := regexp_split_to_array(v_raw, '[!%]');
BEGIN
  IF array_length(v_partes, 1) >= 3 THEN
    codigo := v_partes[1];
    color  := nullif(v_partes[2], '');
    talle  := nullif(v_partes[3], '');
  ELSIF array_length(v_partes, 1) = 2 THEN
    codigo := v_partes[1];
    color  := nullif(left(v_partes[2], 2), '');
    talle  := nullif(substr(v_partes[2], 3), '');
  ELSE
    codigo := v_raw;
  END IF;
END;
$$;

-- Color igual: "02" = "2" si son números; si no, texto igual (ej. "GM")
CREATE OR REPLACE FUNCTION private.mismo_color(a text, b text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(trim(coalesce(a, ''))) ~ '^\d+$' AND upper(trim(coalesce(b, ''))) ~ '^\d+$'
      THEN trim(coalesce(a, ''))::bigint = trim(coalesce(b, ''))::bigint
    ELSE upper(trim(coalesce(a, ''))) = upper(trim(coalesce(b, '')))
  END;
$$;

CREATE OR REPLACE FUNCTION public.escanear_codigo(p_lote uuid, p_local text, p_codigo text)
RETURNS TABLE (item_id uuid, item_escaneadas integer, item_cantidad integer, item_estado text, item_codigo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cb record;
  v_id uuid;
  v_sesion uuid;
  v_desc text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  v_cb := private.parsear_codigo_barras(p_codigo);
  IF coalesce(v_cb.codigo, '') = '' THEN
    RAISE EXCEPTION 'Código vacío' USING ERRCODE = '22023';
  END IF;
  IF NOT private.puede_escanear(p_lote, p_local) THEN
    RAISE EXCEPTION 'Ese repo no está asignado a vos' USING ERRCODE = '42501';
  END IF;

  SELECT s.id INTO v_sesion FROM public.repo_sesiones s
  WHERE s.usuario_id = auth.uid() AND s.lote_id = p_lote
    AND upper(s.local) = upper(coalesce(p_local, '')) AND s.estado = 'en_curso'
  LIMIT 1;
  IF v_sesion IS NULL THEN
    RAISE EXCEPTION 'Tocá Iniciar (o Reanudar) antes de escanear' USING ERRCODE = '55000';
  END IF;

  SELECT i.id INTO v_id
  FROM public.mayorista_items i
  WHERE i.lote_id = p_lote
    AND upper(coalesce(i.local, '')) = upper(coalesce(p_local, ''))
    AND upper(regexp_replace(coalesce(i.codigo, ''), '\s', '', 'g')) = v_cb.codigo
    AND (v_cb.color IS NULL OR private.mismo_color(i.color, v_cb.color))
    AND (v_cb.talle IS NULL OR upper(trim(coalesce(i.talle, ''))) = v_cb.talle)
    AND i.estado = 'pendiente'
    AND i.escaneadas < i.cantidad
  ORDER BY i.orden, i.id
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    v_desc := v_cb.codigo
      || CASE WHEN v_cb.color IS NOT NULL THEN ' color ' || v_cb.color ELSE '' END
      || CASE WHEN v_cb.talle IS NOT NULL THEN ' talle ' || v_cb.talle ELSE '' END;
    RAISE EXCEPTION '% no está pendiente en este repo', v_desc USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.repo_sesiones SET unidades = unidades + 1 WHERE id = v_sesion;

  RETURN QUERY
  UPDATE public.mayorista_items i
  SET escaneadas = i.escaneadas + 1,
      estado    = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN 'hecho' ELSE i.estado END,
      hecho_at  = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN now() ELSE i.hecho_at END,
      hecho_por = CASE WHEN i.escaneadas + 1 >= i.cantidad THEN auth.uid() ELSE i.hecho_por END
  WHERE i.id = v_id
  RETURNING i.id, i.escaneadas, i.cantidad, i.estado, i.codigo;
END;
$$;

REVOKE ALL ON FUNCTION private.parsear_codigo_barras(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.mismo_color(text, text) FROM PUBLIC, anon;

COMMIT;
