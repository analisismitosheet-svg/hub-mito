-- ============================================================================
-- Pedidos de venta anulados en Dragon (20/11/2026)
--
-- Cuando Dragon anula un pedido (COMPROBANTEV.ANULADO = 1) le BORRA las líneas, el cliente y
-- el total. El sync une cabecera + detalle, así que el anulado dejaba de llegar: en el hub
-- seguía como vigente hasta la copia completa de las 6:30, que lo borraba sin dejar rastro.
--
-- Ahora:
--   * sync-pedidos-venta.js lee aparte los anulados y llama a pedidos_venta_marcar_anulados:
--     se marca anulado = true y quién/cuándo (UMODIFW/FMODIFW/HMODIFW de Dragon), conservando
--     cliente, total y líneas que el hub ya tenía.
--   * pedidos_venta_sync_fin ya no borra los anulados en la copia completa.
--   * En la pantalla se pide el motivo («¿Por qué se anuló?»): pedido_venta_motivo_anulacion.
-- Idempotente.
-- ============================================================================

ALTER TABLE public.pedidos_venta ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE public.pedidos_venta ADD COLUMN IF NOT EXISTS anulado_por text;
ALTER TABLE public.pedidos_venta ADD COLUMN IF NOT EXISTS anulado_motivo text;
ALTER TABLE public.pedidos_venta ADD COLUMN IF NOT EXISTS anulado_motivo_por text;
ALTER TABLE public.pedidos_venta ADD COLUMN IF NOT EXISTS anulado_motivo_at timestamptz;

-- p_anulados: [{codigo, por, cuando}] (cuando en ISO con -03:00)
CREATE OR REPLACE FUNCTION public.pedidos_venta_marcar_anulados(p_token text, p_anulados jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  UPDATE public.pedidos_venta p
     SET anulado = true,
         anulado_por = nullif(btrim(a->>'por'), ''),
         anulado_at = nullif(a->>'cuando', '')::timestamptz,
         actualizado_at = now()
    FROM jsonb_array_elements(coalesce(p_anulados, '[]'::jsonb)) a
   WHERE p.codigo = btrim(a->>'codigo')
     AND (NOT p.anulado OR p.anulado_at IS DISTINCT FROM nullif(a->>'cuando', '')::timestamptz);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.pedidos_venta_marcar_anulados(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pedidos_venta_marcar_anulados(text, jsonb) TO anon, authenticated;

-- El motivo lo escribe cualquiera que ve Pedidos de venta (queda quién y cuándo)
CREATE OR REPLACE FUNCTION public.pedido_venta_motivo_anulacion(p_codigo text, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.tengo_permiso('pedidos_venta.view') THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Escribí por qué se anuló';
  END IF;
  UPDATE public.pedidos_venta
     SET anulado_motivo = left(btrim(p_motivo), 500),
         anulado_motivo_por = (SELECT coalesce(u.nombre, u.email) FROM public.usuarios u WHERE u.id = auth.uid()),
         anulado_motivo_at = now()
   WHERE codigo = p_codigo AND anulado;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no está anulado';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.pedido_venta_motivo_anulacion(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_venta_motivo_anulacion(text, text) TO authenticated;

-- La copia completa no borra los anulados (en Dragon ya no tienen líneas y no vuelven a llegar)
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.pedidos_venta_sync_fin(text,bigint,integer,text,boolean)'::regprocedure);
  IF position('sync_gen < p_gen AND NOT anulado' in d) = 0 THEN
    n := replace(d, 'DELETE FROM public.pedidos_venta WHERE sync_gen < p_gen;',
                    'DELETE FROM public.pedidos_venta WHERE sync_gen < p_gen AND NOT anulado;');
    IF n = d THEN RAISE EXCEPTION 'pedidos_venta_sync_fin: no encontré el texto a reemplazar'; END IF;
    EXECUTE n;
  END IF;
END $$;
