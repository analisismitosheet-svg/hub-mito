-- ============================================================
-- Franquicias · reposición automática por Telegram (20/11/2026)
-- La pantalla de Reposición diaria automática muestra, por número del cliente, si ya
-- se vinculó al bot (sin vínculo no le llega nada). telegram_vinculos solo lo leen
-- admin / informes: esta RPC deja ver a mayorista SOLO cuáles de los números pedidos
-- están vinculados (nunca el chat ni otros números).
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/franquicias_telegram.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.franquicias_telegram_vinculados(p_claves text[])
RETURNS TABLE (telefono text, vinculado_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.tengo_permiso('mayorista.franquicias.view') THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.telefono, v.vinculado_at
    FROM public.telegram_vinculos v
    WHERE v.telefono = ANY (COALESCE(p_claves, '{}'::text[]));
END $$;

REVOKE ALL ON FUNCTION public.franquicias_telegram_vinculados(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.franquicias_telegram_vinculados(text[]) TO authenticated;

-- ---- Nombre de quien se vinculó (25/11/2026) ----
-- Se guarda al compartir el número (first_name + last_name del contacto) y, para los
-- que ya estaban, lo completa /api/informe {telegram:'estado'} con getChat
-- (completarNombresTelegram en src/lib/telegram.ts). La pantalla muestra «Nombre (+teléfono)».
ALTER TABLE public.telegram_vinculos ADD COLUMN IF NOT EXISTS nombre text;

DROP FUNCTION IF EXISTS public.franquicias_telegram_vinculados(text[]);
CREATE FUNCTION public.franquicias_telegram_vinculados(p_claves text[])
RETURNS TABLE(telefono text, vinculado_at timestamptz, nombre text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.tengo_permiso('mayorista.franquicias.view') THEN
    RAISE EXCEPTION 'Sin permiso' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT v.telefono, v.vinculado_at, v.nombre
    FROM public.telegram_vinculos v
    WHERE v.telefono = ANY (COALESCE(p_claves, '{}'::text[]));
END $$;
REVOKE ALL ON FUNCTION public.franquicias_telegram_vinculados(text[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.franquicias_telegram_vinculados(text[]) TO authenticated;
