-- ============================================================================
-- Avisos push (Web Push) al celular de los legajos: suena aunque esté bloqueado
--
-- Aplicado en Supabase (migración push_suscripciones). Idempotente.
--
-- push_suscripciones   un celular/navegador anotado para recibir avisos (endpoint +
--                      claves que da el navegador). Lo escribe solo push_suscribir().
-- push_suscribir()     lo llama Mi repo al tocar "Activar avisos" (legajos y piso).
-- push_desuscribir()   borra la suscripción de ese celular.
-- api/push-armado.ts (Vercel, con service role) lee la tabla y manda el aviso
-- cuando el mayorista pide un armado; las suscripciones vencidas (404/410) se borran.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_suscripciones (
  endpoint   text PRIMARY KEY,
  usuario_id uuid NOT NULL DEFAULT auth.uid(),
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  agente     text,
  creado_at  timestamptz NOT NULL DEFAULT now(),
  usado_at   timestamptz
);
CREATE INDEX IF NOT EXISTS push_suscripciones_usuario_idx ON public.push_suscripciones (usuario_id);

ALTER TABLE public.push_suscripciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_suscripciones FROM anon, authenticated;
GRANT SELECT ON public.push_suscripciones TO authenticated;
DROP POLICY IF EXISTS push_suscripciones_mias ON public.push_suscripciones;
CREATE POLICY push_suscripciones_mias ON public.push_suscripciones
  FOR SELECT TO authenticated USING (usuario_id = auth.uid());

CREATE OR REPLACE FUNCTION public.push_suscribir(p_endpoint text, p_p256dh text, p_auth text, p_agente text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sin sesión'; END IF;
  IF NOT (private.tengo_permiso('mayorista.repos_piso')
          OR coalesce((SELECT u.email FROM public.usuarios u WHERE u.id = auth.uid()), '') ILIKE '%@empleados.hub-mito.app') THEN
    RAISE EXCEPTION 'Sin permiso para recibir avisos de armados';
  END IF;
  IF coalesce(p_endpoint, '') !~ '^https://' THEN RAISE EXCEPTION 'Suscripción inválida'; END IF;
  INSERT INTO public.push_suscripciones (endpoint, usuario_id, p256dh, auth, agente)
  VALUES (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_agente, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET usuario_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        agente = excluded.agente, creado_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.push_desuscribir(p_endpoint text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  DELETE FROM public.push_suscripciones WHERE endpoint = p_endpoint AND usuario_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.push_suscribir(text, text, text, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.push_desuscribir(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.push_suscribir(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_desuscribir(text) TO authenticated;

-- Marca de "ya se avisó por push" en cada armado (para no avisar dos veces)
ALTER TABLE public.mayorista_armados ADD COLUMN IF NOT EXISTS push_at timestamptz;
