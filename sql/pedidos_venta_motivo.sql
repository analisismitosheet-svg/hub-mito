-- ============================================================================
-- Pedidos de venta (Mayorista): motivo del pedido
--
-- Aplicado en Supabase (migración pedidos_venta_motivo). Idempotente.
--
-- Dragonfish guarda el motivo en COMPROBANTEV.MOTIVO (código de 3 letras) y su
-- nombre en ZooLogic.MOTIVO (MOTCOD / MOTDES):
--   REP = REPOSICION LOCALES · VTD = venta diaria · D = DIRECTA · vacío = sin motivo
-- puente-sql/scripts/sync-pedidos-venta.js lo copia en motivo / motivo_nombre.
-- ============================================================================

ALTER TABLE public.pedidos_venta
  ADD COLUMN IF NOT EXISTS motivo text,
  ADD COLUMN IF NOT EXISTS motivo_nombre text;

-- pedidos_venta_sync_lote: además de lo de siempre guarda motivo y motivo_nombre
DO $$
DECLARE v text; v0 text;
BEGIN
  v := pg_get_functiondef('public.pedidos_venta_sync_lote'::regproc);
  IF position('motivo_nombre' in v) > 0 THEN RETURN; END IF;
  v0 := v;
  v := replace(v, E'INSERT INTO public.pedidos_venta AS p\n    (codigo, numero,', E'INSERT INTO public.pedidos_venta AS p\n    (codigo, motivo, motivo_nombre, numero,');
  v := replace(v, E'SELECT trim(f->>''codigo''), (f->>''numero'')::integer,', E'SELECT trim(f->>''codigo''), nullif(trim(f->>''motivo''), ''''), nullif(trim(f->>''motivo_nombre''), ''''), (f->>''numero'')::integer,');
  v := replace(v, 'SET numero = excluded.numero,', 'SET motivo = excluded.motivo, motivo_nombre = excluded.motivo_nombre, numero = excluded.numero,');
  IF (length(v) - length(v0)) < 150 THEN
    RAISE EXCEPTION 'No se aplicaron los reemplazos';
  END IF;
  EXECUTE v;
END $$;
