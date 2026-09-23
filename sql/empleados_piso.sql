-- =====================================================
-- INGRESO DE EMPLEADOS A PISO + REPO MAYORISTA CON ESCANEO
--
-- Ejecutar en Supabase SQL Editor, en orden.
-- Idempotente: se puede re-ejecutar sin romper nada.
--
-- Qué agrega:
--   1. usuarios.legajo          -> liga la cuenta de login con la fila de `empleados`
--   2. mayorista_items.escaneadas -> contador de unidades escaneadas (el codigo se repite)
--   3. permiso `mayorista.repos_piso` + rol `empleado`
--   4. mi_perfil() devuelve el legajo (lo necesita la pantalla de piso)
--   5. private.mi_empleado_id()  -> helper de RLS (legajo -> empleados.id)
--   6. RLS del piso: el empleado solo ve los (lote, local) que le asignaron
-- =====================================================


-- -----------------------------------------------------
-- DIAGNOSTICO previo: ¿Qué tablas ya tienen RLS?
--   relrowsecurity = true  -> RLS activo (el bloque 7 aplica de una)
--   relrowsecurity = false -> RLS apagado: el bloque 7 NO restringe nada.
--                             Si querés que restrinja, ejecutá el bloque 7d.
-- -----------------------------------------------------
SELECT c.relname AS tabla, c.relrowsecurity AS rls_activado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('usuarios', 'mayorista_items', 'mayorista_responsables', 'empleados')
ORDER BY c.relname;


-- =====================================================
-- 1. LEGAJO EN LA CUENTA DE USUARIO
-- =====================================================
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS legajo text;

-- Legajo unico entre cuentas (un mismo legajo no puede tener dos logins)
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_legajo_uq
  ON public.usuarios (legajo)
  WHERE legajo IS NOT NULL;


-- =====================================================
-- 2. CONTADOR DE UNIDADES ESCANEADAS
--
-- En un repo el mismo codigo aparece varias veces / con cantidad > 1.
-- Cada escaneo suma UNA unidad. El item se da por hecho cuando
-- escaneadas >= cantidad, recien ahi sale de la lista del piso.
-- =====================================================
ALTER TABLE public.mayorista_items ADD COLUMN IF NOT EXISTS escaneadas integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mayorista_items_escaneadas_ck'
      AND conrelid = 'public.mayorista_items'::regclass
  ) THEN
    ALTER TABLE public.mayorista_items
      ADD CONSTRAINT mayorista_items_escaneadas_ck CHECK (escaneadas >= 0);
  END IF;
END $$;

-- Resumen por lote: mismas columnas de antes + escaneadas (agrega al final,
-- que es lo unico que CREATE OR REPLACE VIEW permite).
CREATE OR REPLACE VIEW public.vw_mayorista_resumen
WITH (security_invoker = true) AS
SELECT
  lote_id,
  count(*) AS items,
  coalesce(sum(cantidad), 0) AS total,
  coalesce(sum(cantidad) FILTER (WHERE estado = 'hecho'), 0) AS hecho,
  coalesce(sum(cantidad) FILTER (WHERE estado = 'faltante'), 0) AS faltante,
  coalesce(sum(escaneadas), 0) AS escaneadas
FROM public.mayorista_items
GROUP BY lote_id;

GRANT SELECT ON public.vw_mayorista_resumen TO authenticated;


-- =====================================================
-- 3. PERMISO DE LA PANTALLA DE PISO + ROL EMPLEADO
--
-- `mayorista.repos_piso` es la pantalla que el administrador activa (o no)
-- a cada empleado desde /usuarios. Quien no lo tiene ni la ve ni entra.
-- =====================================================
INSERT INTO public.permisos (clave, modulo, accion, label, orden)
SELECT
  'mayorista.repos_piso',
  'mayorista',
  'view',
  'Repos Mayorista · escaneo en piso',
  coalesce((SELECT max(orden) FROM public.permisos), 0) + 10
WHERE NOT EXISTS (SELECT 1 FROM public.permisos WHERE clave = 'mayorista.repos_piso');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE codigo = 'empleado') THEN
    INSERT INTO public.roles (codigo, nombre, es_admin, protegido, orden)
    VALUES (
      'empleado',
      'Empleado',
      false,
      false,
      coalesce((SELECT max(orden) FROM public.roles), 0) + 10
    );
  END IF;
END $$;

-- Si existe el rol base "empleado", le damos de alta el permiso de piso.
-- (Si el rol es nuevo y todavia no tiene permisos, se setean desde /roles.)
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'empleado', 'mayorista.repos_piso'
WHERE EXISTS (SELECT 1 FROM public.roles WHERE codigo = 'empleado')
  AND NOT EXISTS (
    SELECT 1 FROM public.rol_permisos
    WHERE rol = 'empleado' AND permiso_clave = 'mayorista.repos_piso'
  );

-- El menu principal filtra las areas por `area_<id>.view`. Sin este permiso el
-- empleado no ve el card de "Mayorista" y nunca llega a la pantalla de piso.
INSERT INTO public.permisos (clave, modulo, accion, label, orden)
SELECT
  'area_mayorista.view',
  'area_mayorista',
  'view',
  'Área Mayorista · visible en el menú',
  coalesce((SELECT max(orden) FROM public.permisos), 0) + 10
WHERE NOT EXISTS (SELECT 1 FROM public.permisos WHERE clave = 'area_mayorista.view');

INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT 'empleado', 'area_mayorista.view'
WHERE EXISTS (SELECT 1 FROM public.roles WHERE codigo = 'empleado')
  AND NOT EXISTS (
    SELECT 1 FROM public.rol_permisos
    WHERE rol = 'empleado' AND permiso_clave = 'area_mayorista.view'
  );


-- =====================================================
-- 4. mi_perfil() DEVUELVE EL LEGAJO
--
-- AuthContext lo usa para resolver "quien soy" en la pantalla de piso.
-- (Si aun no se corrio esto, `legajo` viene undefined y la pantalla de piso
--  muestra el aviso en vez de romper.)
-- =====================================================
DROP FUNCTION IF EXISTS public.mi_perfil();

CREATE FUNCTION public.mi_perfil()
RETURNS TABLE (
  id uuid,
  email text,
  nombre text,
  rol text,
  estado text,
  es_admin boolean,
  motivo_rechazo text,
  local text,
  roles text[],
  legajo text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    ) AS roles,
    u.legajo
  FROM public.usuarios u
  LEFT JOIN public.roles r ON r.codigo = u.rol
  WHERE u.id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.mi_perfil() TO authenticated;


-- =====================================================
-- 5. SINCRONIZA escaneadas CON estado
--
-- El admin marca "hecho" con un botón (sin escanear) y el piso marca
-- escaneando. Este trigger mantiene las dos cosas consistentes:
--   hecho  -> todas las unidades cuentan como escaneadas
--   hecho -> pendiente (el admin desmarca) -> vuelve a 0
-- El piso, al deshacer, deja estado igual que antes, así que NO se resetea.
-- =====================================================
CREATE OR REPLACE FUNCTION public.mayorista_items_sync_escaneadas()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'hecho' THEN
    -- Quien lo marcar hecho sin escanear: todas las unidades cuentan.
    NEW.escaneadas := GREATEST(coalesce(NEW.cantidad, 0), coalesce(NEW.escaneadas, 0));
  ELSIF TG_OP = 'UPDATE'
        AND OLD.estado = 'hecho'
        AND NEW.estado = 'pendiente' THEN
    -- El admin desmarcó: hay que poder volver a escanear desde cero.
    NEW.escaneadas := 0;
  END IF;

  IF coalesce(NEW.escaneadas, 0) < 0 THEN
    NEW.escaneadas := 0;
  ELSIF coalesce(NEW.escaneadas, 0) > coalesce(NEW.cantidad, 0) THEN
    NEW.escaneadas := coalesce(NEW.cantidad, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mayorista_items_escaneadas ON public.mayorista_items;
CREATE TRIGGER trg_mayorista_items_escaneadas
  BEFORE INSERT OR UPDATE ON public.mayorista_items
  FOR EACH ROW
  EXECUTE FUNCTION public.mayorista_items_sync_escaneadas();


-- =====================================================
-- 6. HELPER: de mi legajo a mi id de empleado
--     usuarios.legajo  ->  empleados.legajo  ->  empleados.id
--     (mayorista_responsables.empleado_id apunta a empleados.id)
-- =====================================================
CREATE OR REPLACE FUNCTION private.mi_empleado_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM public.usuarios u
  JOIN public.empleados e ON e.legajo = u.legajo
  WHERE u.id = auth.uid()
    AND u.legajo IS NOT NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION private.mi_empleado_id() TO authenticated;


-- =====================================================
-- 7. RLS DEL PISO  (politicas NUEVAS: no tocan las existentes)
--
-- En Postgres las politicas del mismo comando se combinan con OR,
-- asi que agregar estas NUNCA le quita acceso a nadie.
-- Solo dan acceso extra al empleado sobre SUS filas.
-- =====================================================

-- 7a. El empleado solo ve las asignaciones que son suyas
DROP POLICY IF EXISTS "mayorista_responsables_piso" ON public.mayorista_responsables;
CREATE POLICY "mayorista_responsables_piso" ON public.mayorista_responsables
  FOR SELECT
  USING (empleado_id = private.mi_empleado_id());

-- 7b. El empleado solo LEE los items de sus (lote, local) asignados
DROP POLICY IF EXISTS "mayorista_items_piso_select" ON public.mayorista_items;
CREATE POLICY "mayorista_items_piso_select" ON public.mayorista_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.mayorista_responsables mr
      WHERE mr.lote_id = mayorista_items.lote_id
        AND upper(coalesce(mr.local, '')) = upper(coalesce(mayorista_items.local, ''))
        AND mr.empleado_id = private.mi_empleado_id()
    )
  );

-- 7c. El empleado solo MARCA (update) los items de sus (lote, local)
DROP POLICY IF EXISTS "mayorista_items_piso_update" ON public.mayorista_items;
CREATE POLICY "mayorista_items_piso_update" ON public.mayorista_items
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.mayorista_responsables mr
      WHERE mr.lote_id = mayorista_items.lote_id
        AND upper(coalesce(mr.local, '')) = upper(coalesce(mayorista_items.local, ''))
        AND mr.empleado_id = private.mi_empleado_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.mayorista_responsables mr
      WHERE mr.lote_id = mayorista_items.lote_id
        AND upper(coalesce(mr.local, '')) = upper(coalesce(mayorista_items.local, ''))
        AND mr.empleado_id = private.mi_empleado_id()
    )
  );


-- -----------------------------------------------------
-- 7d. HABILITAR RLS (ejecutar SOLO si el diagnostico de arriba
--     devolvio rls_activado = false Y queres que el filtro aplique).
--
--     Antes de correrlo, confirma que las politicas de escritura/lectura
--     "normales" existen (si no, nadie va a poder leer la tabla).
--     Como revertir:
--       ALTER TABLE public.mayorista_items DISABLE ROW LEVEL SECURITY;
--       ALTER TABLE public.mayorista_responsables DISABLE ROW LEVEL SECURITY;
-- -----------------------------------------------------
-- ALTER TABLE public.mayorista_responsables ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.mayorista_items        ENABLE ROW LEVEL SECURITY;
