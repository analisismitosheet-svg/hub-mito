-- ============================================================
-- Telegram (06/11/2026): reemplaza a WhatsApp, que cobra por mensaje.
-- Cada persona abre el bot y comparte su número una vez; acá queda qué chat es de qué teléfono.
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/telegram_vinculos.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_vinculos (
  -- clave: claveTelefono() de src/lib/informes.ts, sin el 9
  telefono     text PRIMARY KEY,
  chat_id      bigint NOT NULL,
  vinculado_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_vinculos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_vinculos FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_vinculos TO service_role;

-- La pantalla de contactos solo ve quién está vinculado, no el chat
GRANT SELECT (telefono, vinculado_at) ON public.telegram_vinculos TO authenticated;

DROP POLICY IF EXISTS telegram_vinculos_ver ON public.telegram_vinculos;
CREATE POLICY telegram_vinculos_ver ON public.telegram_vinculos
  FOR SELECT TO authenticated
  USING (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.view'));
