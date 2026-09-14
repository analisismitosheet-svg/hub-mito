-- =====================================================
-- OPTIMIZACION: carga rapida de Repos Mayorista / Depósito
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- Índices por lote (aceleran el filtro de ítems de un lote)
CREATE INDEX IF NOT EXISTS idx_mayorista_items_lote ON public.mayorista_items (lote_id);
CREATE INDEX IF NOT EXISTS idx_deposito_items_lote ON public.deposito_items (lote_id);

-- Resumen por lote (para pintar la barra de progreso sin traer los ítems).
-- security_invoker = true respeta el RLS de mayorista_items.
CREATE OR REPLACE VIEW public.vw_mayorista_resumen
WITH (security_invoker = true) AS
SELECT
  lote_id,
  count(*) AS items,
  coalesce(sum(cantidad), 0) AS total,
  coalesce(sum(cantidad) FILTER (WHERE estado = 'hecho'), 0) AS hecho,
  coalesce(sum(cantidad) FILTER (WHERE estado = 'faltante'), 0) AS faltante
FROM public.mayorista_items
GROUP BY lote_id;

CREATE OR REPLACE VIEW public.vw_deposito_resumen
WITH (security_invoker = true) AS
SELECT
  lote_id,
  count(*) AS items,
  coalesce(sum(cantidad), 0) AS total,
  coalesce(sum(cantidad) FILTER (WHERE estado = 'hecho'), 0) AS hecho,
  coalesce(sum(cantidad) FILTER (WHERE estado = 'faltante'), 0) AS faltante
FROM public.deposito_items
GROUP BY lote_id;

-- Permisos de lectura para el rol authenticated
GRANT SELECT ON public.vw_mayorista_resumen TO authenticated;
GRANT SELECT ON public.vw_deposito_resumen TO authenticated;