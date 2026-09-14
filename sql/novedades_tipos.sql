-- =====================================================
-- MIGRACION: Tipos de Novedades (ABM)
-- Ejecutar en Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS public.novedades_tipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.novedades_tipos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "novedades_tipos lectura" ON public.novedades_tipos FOR SELECT USING (true);
CREATE POLICY "novedades_tipos escritura" ON public.novedades_tipos FOR INSERT WITH CHECK (true);
CREATE POLICY "novedades_tipos update" ON public.novedades_tipos FOR UPDATE USING (true);
CREATE POLICY "novedades_tipos delete" ON public.novedades_tipos FOR DELETE USING (true);

-- Cargar los tipos actuales (idempotente)
INSERT INTO public.novedades_tipos (nombre) VALUES
  ('MITO'), ('PPP'), ('MAS26'), ('PFOMENTAR')
ON CONFLICT (nombre) DO NOTHING;