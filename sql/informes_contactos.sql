-- ============================================================
-- CONTACTOS de los informes por WhatsApp  (Envío informes y reportes)
--
-- Agenda única de nombre + WhatsApp. Cada informe elige sus contactos: en
-- informes.destinatarios queda { nombre, telefono, contacto_id }. Al enviar, el
-- servidor toma el nombre y el teléfono ACTUALES del contacto (si se le cambia el
-- número, todos sus informes lo usan) y no le manda a los contactos desactivados.
--
-- Al aplicarlo carga como contactos los destinatarios que ya tenían los informes
-- (uno por teléfono) y los vincula. Idempotente. Ejecutar:
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp sql/informes_contactos.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.informes_contactos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  -- formato internacional, solo dígitos (ej. 5493511234567)
  telefono   text NOT NULL UNIQUE CHECK (telefono ~ '^[0-9]{8,15}$'),
  nota       text,
  activo     boolean NOT NULL DEFAULT true,
  creado_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.informes_contactos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.informes_contactos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.informes_contactos TO authenticated, service_role;

-- Mismos permisos que los informes
DROP POLICY IF EXISTS informes_contactos_ver ON public.informes_contactos;
CREATE POLICY informes_contactos_ver ON public.informes_contactos
  FOR SELECT TO authenticated
  USING (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.view'));

DROP POLICY IF EXISTS informes_contactos_crear ON public.informes_contactos;
CREATE POLICY informes_contactos_crear ON public.informes_contactos
  FOR INSERT TO authenticated
  WITH CHECK (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave IN ('sistemas.informes.create', 'sistemas.informes.edit')));

DROP POLICY IF EXISTS informes_contactos_editar ON public.informes_contactos;
CREATE POLICY informes_contactos_editar ON public.informes_contactos
  FOR UPDATE TO authenticated
  USING (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.edit'))
  WITH CHECK (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.edit'));

DROP POLICY IF EXISTS informes_contactos_borrar ON public.informes_contactos;
CREATE POLICY informes_contactos_borrar ON public.informes_contactos
  FOR DELETE TO authenticated
  USING (public.soy_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = 'sistemas.informes.delete'));

-- Los destinatarios que ya estaban cargados pasan a ser contactos (el primer nombre que aparece por teléfono)
INSERT INTO public.informes_contactos (nombre, telefono)
SELECT DISTINCT ON (tel) coalesce(nullif(btrim(d->>'nombre'), ''), tel), tel
  FROM public.informes i,
       jsonb_array_elements(i.destinatarios) d,
       LATERAL (SELECT regexp_replace(coalesce(d->>'telefono', ''), '\D', '', 'g') AS tel) t
 WHERE tel ~ '^[0-9]{8,15}$'
 ORDER BY tel, i.creado_at
ON CONFLICT (telefono) DO NOTHING;

-- ...y cada destinatario queda vinculado a su contacto
UPDATE public.informes i
   SET destinatarios = (
     SELECT coalesce(jsonb_agg(
              CASE WHEN c.id IS NULL THEN d
                   ELSE jsonb_build_object('nombre', c.nombre, 'telefono', c.telefono, 'contacto_id', c.id) END
              ORDER BY o), '[]'::jsonb)
       FROM jsonb_array_elements(i.destinatarios) WITH ORDINALITY AS x(d, o)
       LEFT JOIN public.informes_contactos c
              ON c.telefono = regexp_replace(coalesce(x.d->>'telefono', ''), '\D', '', 'g')
   )
 WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(i.destinatarios) d WHERE NOT d ? 'contacto_id');
