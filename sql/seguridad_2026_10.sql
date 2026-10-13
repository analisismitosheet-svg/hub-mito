-- =====================================================
-- Revisión de seguridad (octubre 2026). Idempotente. Cada bloque = un hallazgo.
-- =====================================================

-- ---- #1 Fotos de DNI (Cuentas amigos) ----
-- Antes: bucket público y lectura para `public` -> cualquiera sin sesión listaba y bajaba
-- los DNI; cualquier logueado subía o pisaba archivos. Ahora: bucket privado, mismos
-- permisos que la tabla cuentas_amigos (tiene_permiso ya exige usuario aprobado) y la
-- pantalla muestra las fotos con URL firmada.
UPDATE storage.buckets
   SET public = false, file_size_limit = 10485760, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
 WHERE id = 'dni';
DROP POLICY IF EXISTS dni_public_read ON storage.objects;
DROP POLICY IF EXISTS dni_auth_insert ON storage.objects;
DROP POLICY IF EXISTS dni_auth_update ON storage.objects;
DROP POLICY IF EXISTS dni_leer ON storage.objects;
DROP POLICY IF EXISTS dni_subir ON storage.objects;
DROP POLICY IF EXISTS dni_actualizar ON storage.objects;
CREATE POLICY dni_leer ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'dni' AND private.tiene_permiso('cuentas_amigos.view'));
CREATE POLICY dni_subir ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dni' AND (private.tiene_permiso('cuentas_amigos.create') OR private.tiene_permiso('cuentas_amigos.edit')));
CREATE POLICY dni_actualizar ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'dni' AND private.tiene_permiso('cuentas_amigos.edit'))
  WITH CHECK (bucket_id = 'dni' AND private.tiene_permiso('cuentas_amigos.edit'));

-- La tabla tenía además una lectura abierta a cualquier logueado (qual = true) que
-- anulaba ca_view (cuentas_amigos.view): nombres, DNI y teléfonos para cualquiera.
DROP POLICY IF EXISTS cuentas_amigos_select_auth ON public.cuentas_amigos;

-- ---- #2 Endpoints /api que solo validaban el JWT ----
-- El registro es abierto y el usuario nuevo queda 'pendiente' pero con un JWT válido.
-- Los endpoints ahora llaman a esta RPC con el JWT del usuario: aprobado (o admin) y,
-- si se pasan claves, con al menos uno de esos permisos.
CREATE OR REPLACE FUNCTION public.api_autorizado(p_claves text[] DEFAULT '{}')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
     AND (private.es_admin() OR private.usuario_aprobado())
     AND (coalesce(cardinality(p_claves), 0) = 0
          OR private.es_admin()
          OR EXISTS (SELECT 1 FROM unnest(p_claves) AS c WHERE private.tiene_permiso(c)))
$$;
REVOKE ALL ON FUNCTION public.api_autorizado(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.api_autorizado(text[]) TO authenticated;

-- ---- #4 Etiquetas QR: valores que van a un <style> ----
-- config_app.qr_etiqueta la edita quien tiene banner.editar y se imprime en una ventana del
-- mismo origen: los colores y la alineación se validan al guardar (además del saneo en el front).
CREATE OR REPLACE FUNCTION private.config_app_validar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.clave = 'qr_etiqueta' THEN
    IF coalesce(NEW.valor->>'bg_color', '#ffffff') !~* '^(#[0-9a-f]{3,8}|[a-z]{3,20})$'
       OR coalesce(NEW.valor->>'text_color', '#000000') !~* '^(#[0-9a-f]{3,8}|[a-z]{3,20})$' THEN
      RAISE EXCEPTION 'Color inválido en la etiqueta QR (usá #rrggbb)';
    END IF;
    IF coalesce(NEW.valor->>'align', 'center') NOT IN ('left', 'center', 'right') THEN
      RAISE EXCEPTION 'Alineación inválida en la etiqueta QR';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS config_app_validar ON public.config_app;
CREATE TRIGGER config_app_validar BEFORE INSERT OR UPDATE ON public.config_app
  FOR EACH ROW EXECUTE FUNCTION private.config_app_validar();

-- ---- #5 Push de faltantes: un solo aviso por armado ----
ALTER TABLE public.mayorista_armados ADD COLUMN IF NOT EXISTS push_faltantes_at timestamptz;

-- ---- #6 vw_estadisticas_rendimiento: la leía cualquiera sin sesión (vista definer) ----
ALTER VIEW public.vw_estadisticas_rendimiento SET (security_invoker = true);
REVOKE ALL ON public.vw_estadisticas_rendimiento FROM anon;

-- ---- #8 / #9 Funciones SECURITY DEFINER que se podían llamar sin sesión y sin control ----
-- Ninguna pantalla las usa; las que las necesitan (guardar_permisos) corren como dueño.
REVOKE EXECUTE ON FUNCTION public.sincronizar_submodule_areas() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.es_admin_user(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.scopes_usuario(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.permisos_role(text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.permisos_tree(text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_scope(text, text) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_scope(text, text, text) FROM public, anon, authenticated;

-- ---- #12 Registro: nadie queda admin automáticamente ----
-- Antes, quien se registraba con el mail de app_config.admin_email quedaba aprobado y
-- administrador. Si esa cuenta se borraba o el mail cambiaba a uno sin registrar, cualquiera
-- podía registrarse con ese mail y ser admin. Ahora todo registro nuevo queda pendiente.
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  insert into public.usuarios (id, email, nombre, estado, rol)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)), 'pendiente', 'usuario')
  on conflict (id) do nothing;
  return new;
end;
$function$;
