-- ============================================================
-- Migración: Tabla transportes + permisos
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Tabla transportes
CREATE TABLE IF NOT EXISTS public.transportes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre text NOT NULL,
  empresa text,
  telefono text,
  whatsapp text,
  email text,
  patente text,
  tipo_vehiculo text,
  capacidad text,
  zonas_cobertura text,
  horarios text,
  estado text DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'INACTIVO')),
  observaciones text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- 2. RLS (Row Level Security)
ALTER TABLE public.transportes ENABLE ROW LEVEL SECURITY;

-- Policy: todos los autenticados pueden leer
CREATE POLICY "transportes_select_auth" ON public.transportes
  FOR SELECT TO authenticated USING (true);

-- Policy: solo admin o permiso mayorista.transportes.create pueden insertar
CREATE POLICY "transportes_insert" ON public.transportes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND (rol = 'administrador' OR es_admin = true)
    )
    OR EXISTS (
      SELECT 1 FROM public.usuario_permisos up
      JOIN public.permisos p ON p.id = up.permiso_id
      WHERE up.usuario_id = auth.uid() AND p.clave = 'mayorista.transportes.create'
    )
  );

-- Policy: solo admin o permiso mayorista.transportes.edit pueden actualizar
CREATE POLICY "transportes_update" ON public.transportes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND (rol = 'administrador' OR es_admin = true)
    )
    OR EXISTS (
      SELECT 1 FROM public.usuario_permisos up
      JOIN public.permisos p ON p.id = up.permiso_id
      WHERE up.usuario_id = auth.uid() AND p.clave = 'mayorista.transportes.edit'
    )
  );

-- Policy: solo admin o permiso mayorista.transportes.delete pueden eliminar
CREATE POLICY "transportes_delete" ON public.transportes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = auth.uid() AND (rol = 'administrador' OR es_admin = true)
    )
    OR EXISTS (
      SELECT 1 FROM public.usuario_permisos up
      JOIN public.permisos p ON p.id = up.permiso_id
      WHERE up.usuario_id = auth.uid() AND p.clave = 'mayorista.transportes.delete'
    )
  );

-- 3. Permisos para transportes
INSERT INTO public.permisos (clave, descripcion) VALUES
  ('mayorista.transportes.view',   'Ver módulo de transportes'),
  ('mayorista.transportes.create', 'Crear transportes'),
  ('mayorista.transportes.edit',   'Editar transportes'),
  ('mayorista.transportes.delete', 'Eliminar transportes')
ON CONFLICT (clave) DO NOTHING;

-- 4. Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_transportes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transportes_updated_at ON public.transportes;
CREATE TRIGGER trg_transportes_updated_at
  BEFORE UPDATE ON public.transportes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_transportes_updated_at();
