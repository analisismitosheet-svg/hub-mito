-- =====================================================
-- MIGRACION: Multiples roles por usuario
-- Ejecutar en Supabase SQL Editor
-- =====================================================

-- 1. Crear tabla de relacion usuario_roles
CREATE TABLE IF NOT EXISTS public.usuario_roles (
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rol_codigo text NOT NULL REFERENCES public.roles(codigo) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, rol_codigo)
);

-- 2. Migrar datos existentes: usuario.rol -> usuario_roles
INSERT INTO public.usuario_roles (usuario_id, rol_codigo)
SELECT id, rol FROM public.usuarios
WHERE rol IS NOT NULL
ON CONFLICT (usuario_id, rol_codigo) DO NOTHING;

-- 3. Habilitar RLS
ALTER TABLE public.usuario_roles ENABLE ROW LEVEL SECURITY;

-- 4. Policies: los usuarios ven sus propios roles, los admins ven todos
CREATE POLICY "usuarios ven sus roles"
  ON public.usuario_roles FOR SELECT
  USING (usuario_id = auth.uid());

CREATE POLICY "admins gestionan todos los roles"
  ON public.usuario_roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND (u.rol = 'administrador' OR u.es_admin = true)
    )
  );

-- 5. Actualizar funcion mi_perfil para devolver array de roles
CREATE OR REPLACE FUNCTION public.mi_perfil()
RETURNS TABLE (
  id uuid,
  email text,
  nombre text,
  rol text,
  estado text,
  es_admin boolean,
  motivo_rechazo text,
  local text,
  roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.nombre,
    u.rol,
    u.estado::text,
    COALESCE(r.es_admin, false) AS es_admin,
    u.motivo_rechazo,
    u.local,
    ARRAY(
      SELECT ur2.rol_codigo
      FROM public.usuario_roles ur2
      WHERE ur2.usuario_id = u.id
      ORDER BY ur2.rol_codigo
    ) AS roles
  FROM public.usuarios u
  LEFT JOIN public.roles r ON r.codigo = u.rol
  WHERE u.id = auth.uid();
END;
$$;

-- 6. Actualizar funcion mis_permisos para unir permisos de TODOS los roles
CREATE OR REPLACE FUNCTION public.mis_permisos()
RETURNS TABLE (clave text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  -- Permisos de todos los roles del usuario (via usuario_roles)
  SELECT DISTINCT rp.permiso_clave AS clave
  FROM public.usuario_roles ur
  INNER JOIN public.rol_permisos rp ON rp.rol = ur.rol_codigo
  WHERE ur.usuario_id = auth.uid()

  UNION

  -- Permisos extra del usuario (overrides)
  SELECT up.permiso_clave AS clave
  FROM public.usuario_permisos up
  WHERE up.usuario_id = auth.uid()
    AND up.efecto = 'grant';
END;
$$;

-- 7. Funcion helper: obtener roles de un usuario (para el panel admin)
CREATE OR REPLACE FUNCTION public.usuario_roles_usuario(uid uuid)
RETURNS TABLE (rol_codigo text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT ur.rol_codigo
  FROM public.usuario_roles ur
  WHERE ur.usuario_id = uid
  ORDER BY ur.rol_codigo;
END;
$$;

-- 8. Funcion helper: actualizar roles de un usuario (para el panel admin)
CREATE OR REPLACE FUNCTION public.set_usuario_roles(uid uuid, roles_codes text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Borrar roles actuales
  DELETE FROM public.usuario_roles WHERE usuario_id = uid;
  -- Insertar nuevos
  INSERT INTO public.usuario_roles (usuario_id, rol_codigo)
  SELECT uid, unnest(roles_codes)
  WHERE roles_codes IS NOT NULL AND array_length(roles_codes, 1) > 0;
END;
$$;
