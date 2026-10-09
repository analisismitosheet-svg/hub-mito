-- ============================================================
-- INFORMES / REPORTES por WhatsApp  (área Sistemas)
--
-- El "creador de informes" guarda la definición de cada informe y el
-- historial de envíos. El cuerpo se arma de tres formas:
--   vista  -> una vista del SQL Server (como Datos SQL)
--   app    -> datos ya de la app (recepción INDO, armados, pedidos de compra)
--   texto  -> texto libre con {fecha}/{hora}/{dia}
--
-- Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/informes.sql
-- ============================================================

-- ---- 1. Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('sistemas.informes.view',   'sistemas', 'informes.view',   'Ver informes',      880),
  ('sistemas.informes.create', 'sistemas', 'informes.create', 'Crear informes',    881),
  ('sistemas.informes.edit',   'sistemas', 'informes.edit',   'Editar informes',   882),
  ('sistemas.informes.delete', 'sistemas', 'informes.delete', 'Eliminar informes', 883)
ON CONFLICT (clave) DO NOTHING;

-- ---- 2. Definición de los informes ----
CREATE TABLE IF NOT EXISTS public.informes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL,
  activo         boolean NOT NULL DEFAULT true,
  -- de dónde sale el cuerpo
  fuente         text NOT NULL DEFAULT 'texto' CHECK (fuente IN ('vista', 'app', 'texto')),
  -- parámetros de la fuente (jsonb): 
  --   vista -> { vista, donde[], valor, coincide, columnas[], tope }
  --   app   -> { tipo: 'recepcion_indo' | 'armados' | 'pedidos_compra' }
  --   texto -> { plantilla }
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  encabezado     text,
  pie            text,
  -- [{ nombre, telefono }] con el teléfono en formato internacional (ej. 5491122334455)
  destinatarios  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 'manual' = sólo con el botón · 'diario' = todos los días a las `hora`
  modo           text NOT NULL DEFAULT 'manual' CHECK (modo IN ('manual', 'diario')),
  hora           text,                                  -- 'HH:MM' (hora de Argentina) cuando modo='diario'
  dias           text[] NOT NULL DEFAULT ARRAY[]::text[], -- vacío = todos los días; si no: 'lun','mar',…
  ultimo_envio   timestamptz,
  ultimo_ok      boolean,
  ultimo_detalle text,
  creado_por     uuid DEFAULT auth.uid(),
  creado_at      timestamptz NOT NULL DEFAULT now(),
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS informes_activo_idx ON public.informes (activo, modo);

-- ---- 3. Historial de envíos ----
CREATE TABLE IF NOT EXISTS public.informes_envios (
  id         bigserial PRIMARY KEY,
  informe_id uuid REFERENCES public.informes(id) ON DELETE CASCADE,
  enviado_at timestamptz NOT NULL DEFAULT now(),
  destino    text,
  ok         boolean NOT NULL DEFAULT false,
  detalle    text,
  origen     text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'cron', 'prueba'))
);
CREATE INDEX IF NOT EXISTS informes_envios_informe_idx ON public.informes_envios (informe_id, enviado_at DESC);

-- ---- 4. RLS ----
ALTER TABLE public.informes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.informes_envios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.informes, public.informes_envios FROM anon;
-- El cliente edita informes; el historial sólo lo escribe la función de Vercel (service role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.informes TO authenticated;
GRANT SELECT ON public.informes_envios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.informes, public.informes_envios TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.informes_envios_id_seq TO service_role;

DROP POLICY IF EXISTS informes_ver ON public.informes;
CREATE POLICY informes_ver ON public.informes
  FOR SELECT TO authenticated
  USING (
    public.soy_admin()
    OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.view')
  );

DROP POLICY IF EXISTS informes_crear ON public.informes;
CREATE POLICY informes_crear ON public.informes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.soy_admin()
    OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.create')
  );

DROP POLICY IF EXISTS informes_editar ON public.informes;
CREATE POLICY informes_editar ON public.informes
  FOR UPDATE TO authenticated
  USING (
    public.soy_admin()
    OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.edit')
  )
  WITH CHECK (
    public.soy_admin()
    OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.edit')
  );

DROP POLICY IF EXISTS informes_borrar ON public.informes;
CREATE POLICY informes_borrar ON public.informes
  FOR DELETE TO authenticated
  USING (
    public.soy_admin()
    OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.delete')
  );

DROP POLICY IF EXISTS informes_envios_ver ON public.informes_envios;
CREATE POLICY informes_envios_ver ON public.informes_envios
  FOR SELECT TO authenticated
  USING (
    public.soy_admin()
    OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.view')
  );

-- ---- 5. updated_at ----
CREATE OR REPLACE FUNCTION public.informes_touch()
RETURNS trigger AS $$
BEGIN
  NEW.actualizado_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS informes_touch ON public.informes;
CREATE TRIGGER informes_touch
  BEFORE UPDATE ON public.informes
  FOR EACH ROW EXECUTE FUNCTION public.informes_touch();
