-- =====================================================
-- MIGRACION: Motivos de Novedades (ABM con color)
-- Ejecutar en Supabase SQL Editor
-- =====================================================

CREATE TABLE IF NOT EXISTS public.novedades_motivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#6A5ACD',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.novedades_motivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "novedades_motivos lectura" ON public.novedades_motivos FOR SELECT USING (true);
CREATE POLICY "novedades_motivos escritura" ON public.novedades_motivos FOR INSERT WITH CHECK (true);
CREATE POLICY "novedades_motivos update" ON public.novedades_motivos FOR UPDATE USING (true);
CREATE POLICY "novedades_motivos delete" ON public.novedades_motivos FOR DELETE USING (true);

-- Cargar los motivos actuales con sus colores (idempotente)
INSERT INTO public.novedades_motivos (nombre, color) VALUES
  ('INGRESO','#00BFFF'),('AUSENTE','#FF4500'),('TARDANZA','#FFD700'),
  ('APERCIBIM','#4B0082'),('APERCIBIMIENTO','#4B0082'),('EMBARGO','#FF00FF'),
  ('CARPETA MÉDICA','#FFA07A'),('CAMBIO COMISIÓN','#008000'),('RESTAR','#6495ED'),
  ('SUSPENSION','#FF0000'),('CAMBIO LOCAL','#32CD32'),('CAMBIO','#DDA0DD'),
  ('VACACIONES','#7FFFD4'),('BAJA','#00008B'),('LICENCIA','#FFDAB9'),
  ('OTROS','#6A5ACD'),('RECUPERAR','#FF8C00'),('SIN NOVEDADES','#FFFFFF')
ON CONFLICT (nombre) DO UPDATE SET color = EXCLUDED.color;