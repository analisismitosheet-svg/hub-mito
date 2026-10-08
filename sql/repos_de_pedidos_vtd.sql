-- ============================================================================
-- Pedidos de venta VTD ↔ Repos Mayorista
--
-- Aplicado en Supabase (migración repos_de_pedidos_vtd). Idempotente.
--
-- Los pedidos con motivo VTD son la repo diaria de cada local: se cruzan con la
-- repo (mayorista_lotes) de la MISMA fecha que tiene ítems de ese local (cliente
-- del pedido = local de la repo). Se verificó 100 % de cruce desde el 15/09.
-- Devuelve el avance de esa repo para ese local y su responsable, así Pedidos
-- de venta lo muestra igual que un armado (en curso / terminado, en verde).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repos_de_pedidos_vtd(p_desde date)
RETURNS TABLE(codigo text, lote_id uuid, local text, lineas integer, lineas_ok integer,
              unidades integer, unidades_ok integer, faltantes integer, pendientes integer,
              responsable text, legajo text, ultimo_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (private.es_admin() OR private.tengo_permiso('pedidos_venta.view')) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH p AS (
    SELECT pv.codigo, pv.fecha, upper(btrim(pv.cliente)) AS local
      FROM public.pedidos_venta pv
     WHERE pv.motivo = 'VTD' AND pv.fecha >= p_desde AND coalesce(pv.cliente, '') <> ''
  ),
  pl AS (
    SELECT p.codigo, p.local,
           (SELECT l.id FROM public.mayorista_lotes l
             WHERE l.fecha = p.fecha
               AND EXISTS (SELECT 1 FROM public.mayorista_items i WHERE i.lote_id = l.id AND upper(btrim(i.local)) = p.local)
             ORDER BY l.created_at DESC LIMIT 1) AS lote_id
      FROM p
  )
  SELECT pl.codigo, pl.lote_id, pl.local,
         count(*)::integer,
         count(*) FILTER (WHERE i.estado <> 'pendiente')::integer,
         sum(i.cantidad)::integer,
         sum(CASE WHEN i.estado = 'hecho' THEN i.cantidad ELSE least(coalesce(i.escaneadas, 0), i.cantidad) END)::integer,
         sum(CASE WHEN i.estado = 'faltante' THEN i.cantidad - least(coalesce(i.escaneadas, 0), i.cantidad) ELSE 0 END)::integer,
         count(*) FILTER (WHERE i.estado = 'pendiente')::integer,
         (SELECT e.nombre::text FROM public.mayorista_responsables r JOIN public.empleados e ON e.id = r.empleado_id
           WHERE r.lote_id = pl.lote_id AND upper(btrim(r.local)) = pl.local LIMIT 1),
         (SELECT e.legajo::text FROM public.mayorista_responsables r JOIN public.empleados e ON e.id = r.empleado_id
           WHERE r.lote_id = pl.lote_id AND upper(btrim(r.local)) = pl.local LIMIT 1),
         max(i.hecho_at)
    FROM pl
    JOIN public.mayorista_items i ON i.lote_id = pl.lote_id AND upper(btrim(i.local)) = pl.local
   GROUP BY pl.codigo, pl.lote_id, pl.local
  UNION ALL
  -- Los cerrados por única vez (pedidos_vtd_cerrados, abajo): repo terminada sin detalle
  SELECT c.codigo, NULL::uuid, upper(btrim(pv.cliente)), 0, 0, 0, 0, 0, 0, NULL::text, NULL::text, c.cerrado_at
    FROM public.pedidos_vtd_cerrados c
    JOIN public.pedidos_venta pv ON pv.codigo = c.codigo
   WHERE pv.fecha >= p_desde;
END;
$$;

REVOKE ALL ON FUNCTION public.repos_de_pedidos_vtd(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repos_de_pedidos_vtd(date) TO authenticated;

-- ---- Por única vez (2026-10-08): los VTD sin repo en el hub quedan como terminados ----
-- Son los de antes de que las repos se cargaran en el hub. Se guardan en
-- pedidos_vtd_cerrados y repos_de_pedidos_vtd los devuelve como repo terminada
-- (sin unidades ni responsable). Los que tienen repo siguen el avance real.
CREATE TABLE IF NOT EXISTS public.pedidos_vtd_cerrados (
  codigo     text PRIMARY KEY,
  cerrado_at timestamptz NOT NULL DEFAULT now(),
  motivo     text NOT NULL DEFAULT 'historico'
);
ALTER TABLE public.pedidos_vtd_cerrados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedidos_vtd_cerrados FROM anon, authenticated;

INSERT INTO public.pedidos_vtd_cerrados (codigo)
SELECT pv.codigo
  FROM public.pedidos_venta pv
 WHERE pv.motivo = 'VTD' AND pv.fecha <= DATE '2026-10-08'
   AND NOT EXISTS (
     SELECT 1 FROM public.mayorista_lotes l
      WHERE l.fecha = pv.fecha
        AND EXISTS (SELECT 1 FROM public.mayorista_items i WHERE i.lote_id = l.id AND upper(btrim(i.local)) = upper(btrim(pv.cliente))))
ON CONFLICT (codigo) DO NOTHING;
