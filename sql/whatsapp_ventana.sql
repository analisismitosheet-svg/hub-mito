-- ============================================================
-- WhatsApp: mensajes gratis dentro de la ventana de 24 h (06/11/2026)
--
-- Meta da 1.000 mensajes de servicio gratis por mes y por número, solo dentro de las
-- 24 h después de que el contacto escribe. El webhook guarda cuándo escribió cada uno
-- y, si sigue abierta, el servidor manda sin plantilla.
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/whatsapp_ventana.sql
-- ============================================================

-- Último mensaje recibido por teléfono (clave: claveTelefono() de src/lib/informes.ts, sin el 9)
CREATE TABLE IF NOT EXISTS public.whatsapp_ventana (
  telefono          text PRIMARY KEY,
  ultimo_mensaje_at timestamptz NOT NULL
);

-- Mensajes gratis mandados (para contar el cupo del mes). `respaldo` es el mensaje con
-- plantilla listo para mandar si Meta avisa que la ventana ya había vencido (#131047);
-- lleva datos y links privados, así que no se le da a `authenticated`, y se borra al entregarse.
CREATE TABLE IF NOT EXISTS public.whatsapp_servicio_envios (
  id        bigserial PRIMARY KEY,
  wamid     text NOT NULL UNIQUE,
  telefono  text NOT NULL,
  respaldo  jsonb,
  creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_servicio_envios_creado_idx ON public.whatsapp_servicio_envios (creado_at);

-- Por qué vía salió cada informe: 'servicio' (gratis) o 'plantilla' (paga)
ALTER TABLE public.informes_envios ADD COLUMN IF NOT EXISTS via text;

ALTER TABLE public.whatsapp_ventana ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_servicio_envios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_ventana, public.whatsapp_servicio_envios FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_ventana, public.whatsapp_servicio_envios TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.whatsapp_servicio_envios_id_seq TO service_role;

-- La pantalla de contactos solo lee cuándo escribió cada uno y cuántos gratis van (nunca `respaldo`)
GRANT SELECT ON public.whatsapp_ventana TO authenticated;
GRANT SELECT (id, creado_at) ON public.whatsapp_servicio_envios TO authenticated;

DROP POLICY IF EXISTS whatsapp_ventana_ver ON public.whatsapp_ventana;
CREATE POLICY whatsapp_ventana_ver ON public.whatsapp_ventana
  FOR SELECT TO authenticated
  USING (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.view'));

DROP POLICY IF EXISTS whatsapp_servicio_envios_ver ON public.whatsapp_servicio_envios;
CREATE POLICY whatsapp_servicio_envios_ver ON public.whatsapp_servicio_envios
  FOR SELECT TO authenticated
  USING (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.view'));
