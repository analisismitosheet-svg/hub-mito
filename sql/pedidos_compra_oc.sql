-- =====================================================
-- LISTADO DE OC (órdenes de compra) para Recepción INDO
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Encabezado de TODAS las OC de VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA (SQL Server de DESKTOP-OA4GU6I),
-- sin exclusiones (a diferencia de public.pedidos_compra, que deja afuera al proveedor MITO).
-- Lo llena puente-sql/scripts/sync-pedidos-compra.js en la misma corrida horaria, con el PUENTE_TOKEN.
-- Lo lee el selector de N° OC de Recepción INDO (tabla y "Nuevo registro").
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pedidos_compra_oc (
  codigo           text PRIMARY KEY,   -- id interno de Dragonfish
  numero           integer,            -- FNUMCOMP (el N° de OC)
  fecha            date,
  proveedor        text,
  proveedor_nombre text,
  anulado          boolean NOT NULL DEFAULT false,
  actualizado_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pedidos_compra_oc_numero_idx ON public.pedidos_compra_oc (numero);

ALTER TABLE public.pedidos_compra_oc ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedidos_compra_oc FROM anon, authenticated;
GRANT SELECT ON public.pedidos_compra_oc TO authenticated;
DROP POLICY IF EXISTS pedidos_compra_oc_ver ON public.pedidos_compra_oc;
CREATE POLICY pedidos_compra_oc_ver ON public.pedidos_compra_oc
  FOR SELECT TO authenticated
  USING (private.tengo_permiso('deposito.view') OR private.tengo_permiso('pedidos_compra.view'));

-- Reemplaza el listado completo (son ~600 OC: va en una sola llamada).
CREATE OR REPLACE FUNCTION public.pedidos_compra_oc_sync(p_token text, p_ocs jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_ocs) <> 'array' OR jsonb_array_length(p_ocs) = 0 OR jsonb_array_length(p_ocs) > 20000 THEN
    RAISE EXCEPTION 'Listado de OC inválido' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.pedidos_compra_oc
   WHERE codigo NOT IN (SELECT trim(f->>'codigo') FROM jsonb_array_elements(p_ocs) f);
  INSERT INTO public.pedidos_compra_oc AS o (codigo, numero, fecha, proveedor, proveedor_nombre, anulado, actualizado_at)
  SELECT trim(f->>'codigo'), (f->>'numero')::integer, (f->>'fecha')::date,
         nullif(trim(f->>'proveedor'), ''), nullif(trim(f->>'proveedor_nombre'), ''),
         coalesce((f->>'anulado')::boolean, false), now()
  FROM jsonb_array_elements(p_ocs) f
  WHERE coalesce(trim(f->>'codigo'), '') <> ''
  ON CONFLICT (codigo) DO UPDATE
    SET numero = excluded.numero, fecha = excluded.fecha, proveedor = excluded.proveedor,
        proveedor_nombre = excluded.proveedor_nombre, anulado = excluded.anulado, actualizado_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.pedidos_compra_oc_sync(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pedidos_compra_oc_sync(text, jsonb) TO anon, authenticated;

COMMIT;
