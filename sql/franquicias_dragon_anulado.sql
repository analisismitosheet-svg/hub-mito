-- ============================================================
-- Franquicias: pedido anulado en Dragon (20/11/2026)
-- Cuando el pedido de venta que generó una reposición se anula en Dragon
-- (COMPROBANTEV.ANULADO = 1), sync-pedidos-venta.js lo marca en pedidos_venta
-- (sql/pedidos_venta_anulados.sql, cada 15 min). Este trigger lo pasa a la propuesta:
-- dragon_anulado_at / dragon_anulado_por. La propuesta queda en 'en_dragon' (no se
-- reabre el link): la pantalla y el link muestran «Anulado en Dragon».
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/franquicias_dragon_anulado.sql
-- ============================================================

ALTER TABLE public.franquicias_propuestas ADD COLUMN IF NOT EXISTS dragon_anulado_at timestamptz;
ALTER TABLE public.franquicias_propuestas ADD COLUMN IF NOT EXISTS dragon_anulado_por text;

CREATE OR REPLACE FUNCTION private.franquicias_pedido_anulado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.anulado THEN
    UPDATE public.franquicias_propuestas
       SET dragon_anulado_at = coalesce(NEW.anulado_at, now()), dragon_anulado_por = NEW.anulado_por
     WHERE dragon_pedido = NEW.numero::text
       AND (cliente_id IS NULL OR cliente_id = NEW.cliente)
       AND dragon_anulado_at IS DISTINCT FROM coalesce(NEW.anulado_at, now());
  ELSE
    UPDATE public.franquicias_propuestas
       SET dragon_anulado_at = NULL, dragon_anulado_por = NULL
     WHERE dragon_pedido = NEW.numero::text
       AND (cliente_id IS NULL OR cliente_id = NEW.cliente)
       AND dragon_anulado_at IS NOT NULL;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS franquicias_pedido_anulado ON public.pedidos_venta;
CREATE TRIGGER franquicias_pedido_anulado
  AFTER INSERT OR UPDATE OF anulado, anulado_at ON public.pedidos_venta
  FOR EACH ROW EXECUTE FUNCTION private.franquicias_pedido_anulado();

-- Los que ya estaban anulados
UPDATE public.franquicias_propuestas f
   SET dragon_anulado_at = coalesce(p.anulado_at, now()), dragon_anulado_por = p.anulado_por
  FROM public.pedidos_venta p
 WHERE p.anulado AND f.dragon_pedido = p.numero::text
   AND (f.cliente_id IS NULL OR f.cliente_id = p.cliente)
   AND f.dragon_anulado_at IS NULL;

-- El link público también lo muestra
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.propuesta_franquicia_publica'::regproc);
  IF position('dragon_anulado_at' in d) = 0 THEN
    n := replace(d, '''dragon_pedido'', p.dragon_pedido,',
                    '''dragon_pedido'', p.dragon_pedido, ''dragon_anulado_at'', p.dragon_anulado_at,');
    IF n = d THEN RAISE EXCEPTION 'propuesta_franquicia_publica: no encontré el texto a reemplazar'; END IF;
    EXECUTE n;
  END IF;
END $$;
