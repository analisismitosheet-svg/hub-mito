-- =====================================================
-- RECEPCION INDO (Depósito): control de la recepción de mercadería
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- La pantalla (src/pages/RecepcionIndo.tsx) importa el Excel "Recepción de Mercadería"
-- que arma el depósito y guarda cada fila acá. Después el depósito marca cuáles ya
-- controló, sin volver a tocar el Excel.
--
-- Permiso: deposito.view (ver, importar y marcar). Correr sql/recepcion_indo_proveedores.sql
-- después de este archivo: es el catálogo de proveedores del desplegable.
--
-- SIN BEGIN/COMMIT a propósito: si una sentencia falla, el SQL Editor muestra cuál es
-- (con la transacción abierta solo dice "current transaction is aborted" y no se sabe
-- dónde). Todo es idempotente, así que se puede correr de a partes y volver a correr.
-- =====================================================

-- ---- Permisos ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('deposito.view', 'deposito', 'view', 'Ver depósito', 810)
ON CONFLICT (clave) DO NOTHING;
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT r.rol, 'deposito.view'
FROM (VALUES ('deposito'), ('compras')) AS r(rol)
WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = r.rol AND permiso_clave = 'deposito.view');

-- ---- Helpers ----
CREATE OR REPLACE FUNCTION private.tengo_permiso(p_clave text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT private.es_admin() OR EXISTS (SELECT 1 FROM public.mis_permisos() m WHERE m.clave = p_clave)
$$;
REVOKE ALL ON FUNCTION private.tengo_permiso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tengo_permiso(text) TO authenticated;

-- El Excel viene sucio: una celda de fecha puede ser "----", "SIN REMITO" o un link de
-- Drive. Antes que abortar el lote de 500 filas, la celda fea se va a NULL.
CREATE OR REPLACE FUNCTION private.fecha_o_null(p_txt text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v date;
BEGIN
  IF p_txt IS NULL OR btrim(p_txt) = '' THEN RETURN NULL; END IF;
  BEGIN
    v := btrim(p_txt)::date;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v;
END;
$$;

-- Igual que la fecha pero para números: la columna IVA trae cosas como "consignacion"
-- y no puede voltear el lote entero.
CREATE OR REPLACE FUNCTION private.numero_o_null(p_txt text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v numeric;
BEGIN
  IF p_txt IS NULL OR btrim(p_txt) = '' THEN RETURN NULL; END IF;
  BEGIN
    v := btrim(p_txt)::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION private.entero_o_null(p_txt text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v integer;
BEGIN
  IF p_txt IS NULL OR btrim(p_txt) = '' THEN RETURN NULL; END IF;
  BEGIN
    v := btrim(p_txt)::integer;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v;
END;
$$;

-- =====================================================================
-- Tabla de recepciones
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.recepcion_indo (
  -- clave natural que arma el hub (guía + depósito + proveedor + remito + fechas).
  -- No cambia al reimportar el mismo Excel: el upsert actualiza en vez de duplicar.
  clave              text PRIMARY KEY,
  n_guia             text NOT NULL DEFAULT '',
  transporte         text NOT NULL DEFAULT '',
  bultos             integer NOT NULL DEFAULT 0,
  deposito           text NOT NULL DEFAULT '',
  proveedor          text NOT NULL DEFAULT '',
  proveedor_codigo   text,                    -- catálogo (recepcion_indo_proveedores), si se eligió del desplegable
  n_remito           text NOT NULL DEFAULT '',
  fecha_remito       date,
  mes                integer,
  n_oc               text NOT NULL DEFAULT '',  -- puede traer varias: "15183/15347/15329"
  oc_cargada_dragon  boolean NOT NULL DEFAULT false,
  n_factura          text NOT NULL DEFAULT '',
  fecha_factura      date,
  factura_link       text,                      -- la columna "Factura" del Excel es un link de Drive
  fecha_ingreso      date,
  fecha_controlada   date,
  -- La fecha de controlada la pone el hub (o el Excel, si ya venía controlada).
  -- Los días de atraso se derivan, nunca se escriben a mano.
  dias_atraso        integer GENERATED ALWAYS AS (greatest(0, fecha_controlada - fecha_ingreso)) STORED,
  estado             text NOT NULL DEFAULT '',  -- "En deposito" | "Cargado en Flexxus"
  iva                numeric(16,2),
  detalle            text,
  -- Quién y cuándo se controló, desde el hub (el Excel no lo dice).
  controlado_por     uuid,
  controlado_at      timestamptz,
  creado_at          timestamptz NOT NULL DEFAULT now(),
  actualizado_at     timestamptz NOT NULL DEFAULT now(),
  importado_at       timestamptz NOT NULL DEFAULT now(),
  importado_por      uuid
);

-- Si la tabla ya existía con dias_atraso como columna común, se la saca para que la
-- vuelva a crear como generada (si no, el GENERATED de arriba no se aplicaría).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'recepcion_indo'
      AND column_name = 'dias_atraso' AND is_generated <> 'ALWAYS'
  ) THEN
    ALTER TABLE public.recepcion_indo DROP COLUMN dias_atraso;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS recepcion_indo_ingreso_idx    ON public.recepcion_indo (fecha_ingreso DESC);
CREATE INDEX IF NOT EXISTS recepcion_indo_controlada_idx ON public.recepcion_indo (fecha_controlada);
CREATE INDEX IF NOT EXISTS recepcion_indo_deposito_idx   ON public.recepcion_indo (deposito);
CREATE INDEX IF NOT EXISTS recepcion_indo_proveedor_idx  ON public.recepcion_indo (proveedor);

-- =====================================================================
-- Catálogo de proveedores (lo carga sql/recepcion_indo_proveedores.sql
-- desde DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.recepcion_indo_proveedores (
  codigo          text PRIMARY KEY,
  nombre          text NOT NULL,
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recepcion_indo_proveedores_nombre_idx
  ON public.recepcion_indo_proveedores (lower(nombre));

-- =====================================================================
-- RLS
-- =====================================================================
-- Con deposito.view alcanza para ver, importar y marcar (lo pidió así el módulo).
-- Para separar duties después: SELECT -> deposito.view, INSERT -> deposito.import,
-- UPDATE -> deposito.mark (los tres permisos ya existen).
ALTER TABLE public.recepcion_indo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recepcion_indo FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recepcion_indo TO authenticated;

DROP POLICY IF EXISTS recepcion_indo_ver ON public.recepcion_indo;
CREATE POLICY recepcion_indo_ver ON public.recepcion_indo
  FOR SELECT TO authenticated USING (private.tengo_permiso('deposito.view'));
DROP POLICY IF EXISTS recepcion_indo_alta ON public.recepcion_indo;
CREATE POLICY recepcion_indo_alta ON public.recepcion_indo
  FOR INSERT TO authenticated WITH CHECK (private.tengo_permiso('deposito.view'));
DROP POLICY IF EXISTS recepcion_indo_cambio ON public.recepcion_indo;
CREATE POLICY recepcion_indo_cambio ON public.recepcion_indo
  FOR UPDATE TO authenticated USING (private.tengo_permiso('deposito.view'))
  WITH CHECK (private.tengo_permiso('deposito.view'));

ALTER TABLE public.recepcion_indo_proveedores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recepcion_indo_proveedores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recepcion_indo_proveedores TO authenticated;

DROP POLICY IF EXISTS recepcion_indo_prov_ver ON public.recepcion_indo_proveedores;
CREATE POLICY recepcion_indo_prov_ver ON public.recepcion_indo_proveedores
  FOR SELECT TO authenticated USING (private.tengo_permiso('deposito.view'));
DROP POLICY IF EXISTS recepcion_indo_prov_alta ON public.recepcion_indo_proveedores;
CREATE POLICY recepcion_indo_prov_alta ON public.recepcion_indo_proveedores
  FOR INSERT TO authenticated WITH CHECK (private.tengo_permiso('deposito.view'));
DROP POLICY IF EXISTS recepcion_indo_prov_cambio ON public.recepcion_indo_proveedores;
CREATE POLICY recepcion_indo_prov_cambio ON public.recepcion_indo_proveedores
  FOR UPDATE TO authenticated USING (private.tengo_permiso('deposito.view'))
  WITH CHECK (private.tengo_permiso('deposito.view'));

-- Quién y cuándo: siempre el usuario de la sesión, no lo que mande el navegador.
CREATE OR REPLACE FUNCTION private.recepcion_indo_firma()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.actualizado_at := now();
  IF NEW.fecha_controlada IS NULL THEN
    -- descontrolado: se cae la firma
    NEW.controlado_at := NULL;
    NEW.controlado_por := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.fecha_controlada IS DISTINCT FROM OLD.fecha_controlada THEN
    -- recién controlada, o le cambiaron la fecha a mano: pasa a ser del hub
    NEW.controlado_at := now();
    NEW.controlado_por := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS recepcion_indo_firma ON public.recepcion_indo;
CREATE TRIGGER recepcion_indo_firma BEFORE INSERT OR UPDATE ON public.recepcion_indo
  FOR EACH ROW EXECUTE FUNCTION private.recepcion_indo_firma();

-- =====================================================================
-- Importar el Excel: un lote por llamada (el navegador manda 500 por vez)
-- =====================================================================
-- El control es del hub: si el Excel viene sin fecha de controlada NO se pisa la que
-- ya se cargó a mano. Por eso el merge vive acá y no es un upsert llano del navegador.
CREATE OR REPLACE FUNCTION public.recepcion_indo_importar(p_filas jsonb)
RETURNS TABLE (nuevas integer, actualizadas integer, saltadas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_existentes integer := 0;
BEGIN
  IF NOT private.tengo_permiso('deposito.view') THEN
    RAISE EXCEPTION 'Sin permiso de depósito';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' THEN
    RAISE EXCEPTION 'Se esperaba una lista de recepciones';
  END IF;

  WITH entrada AS (
    SELECT upper(btrim(coalesce(x->>'clave', ''))) AS clave
    FROM jsonb_array_elements(p_filas) x
    WHERE btrim(coalesce(x->>'clave', '')) <> ''
  )
  SELECT count(*) INTO v_total FROM entrada;

  WITH claves AS (
    SELECT upper(btrim(coalesce(x->>'clave', ''))) AS clave
    FROM jsonb_array_elements(p_filas) x
    WHERE btrim(coalesce(x->>'clave', '')) <> ''
  )
  SELECT count(*) INTO v_existentes
  FROM public.recepcion_indo t
  WHERE t.clave IN (SELECT clave FROM claves);

  INSERT INTO public.recepcion_indo AS t (
    clave, n_guia, transporte, bultos, deposito, proveedor, proveedor_codigo, n_remito,
    fecha_remito, mes, n_oc, oc_cargada_dragon, n_factura, fecha_factura, factura_link,
    fecha_ingreso, fecha_controlada, estado, iva, detalle
  )
  SELECT
    upper(btrim(coalesce(x->>'clave', ''))),
    btrim(coalesce(x->>'nGuia', '')),
    btrim(coalesce(x->>'transporte', '')),
    coalesce(private.entero_o_null(x->>'bultos'), 0),
    btrim(coalesce(x->>'deposito', '')),
    btrim(coalesce(x->>'proveedor', '')),
    nullif(btrim(coalesce(x->>'proveedorCodigo', '')), ''),
    btrim(coalesce(x->>'nRemito', '')),
    private.fecha_o_null(x->>'fechaRemito'),
    private.entero_o_null(x->>'mes'),
    btrim(coalesce(x->>'nOc', '')),
    coalesce(btrim(coalesce(x->>'ocCargadaDragon', '')) = 'true', false),
    btrim(coalesce(x->>'nFactura', '')),
    private.fecha_o_null(x->>'fechaFactura'),
    nullif(btrim(coalesce(x->>'facturaLink', '')), ''),
    private.fecha_o_null(x->>'fechaIngreso'),
    private.fecha_o_null(x->>'fechaControlada'),
    btrim(coalesce(x->>'estado', '')),
    private.numero_o_null(x->>'iva'),
    nullif(btrim(coalesce(x->>'detalle', '')), '')
  FROM jsonb_array_elements(p_filas) x
  WHERE btrim(coalesce(x->>'clave', '')) <> ''
  ON CONFLICT (clave) DO UPDATE SET
    n_guia            = EXCLUDED.n_guia,
    transporte        = EXCLUDED.transporte,
    bultos            = EXCLUDED.bultos,
    deposito          = EXCLUDED.deposito,
    proveedor         = EXCLUDED.proveedor,
    proveedor_codigo  = COALESCE(EXCLUDED.proveedor_codigo, t.proveedor_codigo),
    n_remito          = EXCLUDED.n_remito,
    fecha_remito      = EXCLUDED.fecha_remito,
    mes               = EXCLUDED.mes,
    n_oc              = EXCLUDED.n_oc,
    oc_cargada_dragon = EXCLUDED.oc_cargada_dragon,
    n_factura         = EXCLUDED.n_factura,
    fecha_factura     = EXCLUDED.fecha_factura,
    factura_link      = EXCLUDED.factura_link,
    fecha_ingreso     = EXCLUDED.fecha_ingreso,
    -- el Excel solo completa el control, nunca lo borra
    fecha_controlada  = COALESCE(EXCLUDED.fecha_controlada, t.fecha_controlada),
    estado            = EXCLUDED.estado,
    iva               = EXCLUDED.iva,
    detalle           = EXCLUDED.detalle,
    importado_at      = now(),
    importado_por     = auth.uid();

  RETURN QUERY SELECT (v_total - v_existentes), v_existentes, 0;
END;
$$;
REVOKE ALL ON FUNCTION public.recepcion_indo_importar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_importar(jsonb) TO authenticated;

-- =====================================================================
-- KPIs (los mismos que la hoja "Seguimiento" del Excel)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.recepcion_indo_resumen(p_deposito text DEFAULT '')
RETURNS TABLE (
  filas                bigint,
  bultos               bigint,
  controladas          bigint,
  bultos_controlados   bigint,
  pendientes           bigint,   -- recepciones sin controlar (el "OC sin controlar" del Excel cuenta filas)
  bultos_pendientes    bigint,
  oc_distintas         bigint,   -- cuántas OC distintas hay entre las pendientes
  atraso_prom          numeric,  -- promedio de días de las CONTROLADAS (el Excel mezcla las pendientes)
  iva_pendiente        numeric,
  mas_viejo_pendiente  date,
  proveedores          bigint,
  ultimo_import        timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH f AS (
    SELECT * FROM public.recepcion_indo
    WHERE private.tengo_permiso('deposito.view')
      AND (nullif(btrim(coalesce(p_deposito, '')), '') IS NULL OR deposito = btrim(p_deposito))
  )
  SELECT
    count(*),
    coalesce(sum(bultos), 0),
    count(*) FILTER (WHERE fecha_controlada IS NOT NULL),
    coalesce(sum(bultos) FILTER (WHERE fecha_controlada IS NOT NULL), 0),
    count(*) FILTER (WHERE fecha_controlada IS NULL),
    coalesce(sum(bultos) FILTER (WHERE fecha_controlada IS NULL), 0),
    count(DISTINCT n_oc) FILTER (WHERE fecha_controlada IS NULL AND btrim(coalesce(n_oc, '')) <> ''),
    round((avg(dias_atraso) FILTER (WHERE dias_atraso IS NOT NULL))::numeric, 2),
    coalesce(sum(iva) FILTER (WHERE fecha_controlada IS NULL), 0),
    min(fecha_ingreso) FILTER (WHERE fecha_controlada IS NULL),
    count(DISTINCT proveedor),
    max(importado_at)
  FROM f
$$;
REVOKE ALL ON FUNCTION public.recepcion_indo_resumen(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_resumen(text) TO authenticated;

-- =====================================================================
-- Listado con filtros y paginado (el navegador pide de a 200)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.recepcion_indo_filas(
  p_deposito     text DEFAULT '',
  p_proveedor    text DEFAULT '',
  p_transporte   text DEFAULT '',
  p_estado       text DEFAULT '',
  p_control      text DEFAULT '',   -- '' | 'pendientes' | 'controladas'
  p_busqueda     text DEFAULT '',
  p_desde        integer DEFAULT 0,
  p_limite       integer DEFAULT 200
)
RETURNS TABLE (
  total bigint, clave text, n_guia text, transporte text, bultos integer, deposito text,
  proveedor text, proveedor_codigo text, n_remito text, fecha_remito date, mes integer,
  n_oc text, oc_cargada_dragon boolean, n_factura text, fecha_factura date, factura_link text,
  fecha_ingreso date, fecha_controlada date, dias_atraso integer, estado text, iva numeric,
  detalle text, controlado_at timestamptz, controlado_por text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH f AS (
    SELECT r.*
    FROM public.recepcion_indo r
    WHERE private.tengo_permiso('deposito.view')
      AND (nullif(btrim(coalesce(p_deposito, '')), '') IS NULL OR r.deposito = btrim(p_deposito))
      AND (nullif(btrim(coalesce(p_proveedor, '')), '') IS NULL OR r.proveedor = btrim(p_proveedor))
      AND (nullif(btrim(coalesce(p_transporte, '')), '') IS NULL OR r.transporte = btrim(p_transporte))
      AND (nullif(btrim(coalesce(p_estado, '')), '') IS NULL OR r.estado = btrim(p_estado))
      AND (
        nullif(btrim(coalesce(p_control, '')), '') IS NULL
        OR (p_control = 'pendientes' AND r.fecha_controlada IS NULL)
        OR (p_control = 'controladas' AND r.fecha_controlada IS NOT NULL)
      )
      AND (
        nullif(btrim(coalesce(p_busqueda, '')), '') IS NULL
        OR r.n_guia ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.n_remito ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.n_factura ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.n_oc ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.proveedor ILIKE '%' || btrim(p_busqueda) || '%'
        OR r.transporte ILIKE '%' || btrim(p_busqueda) || '%'
        OR coalesce(r.detalle, '') ILIKE '%' || btrim(p_busqueda) || '%'
      )
  ), pagina AS (
    SELECT f.*, count(*) OVER () AS total
    FROM f
    ORDER BY f.fecha_ingreso DESC NULLS LAST, f.n_guia, f.clave
    LIMIT greatest(1, least(coalesce(p_limite, 200), 1000))
    OFFSET greatest(0, coalesce(p_desde, 0))
  )
  SELECT
    p.total, p.clave, p.n_guia, p.transporte, p.bultos, p.deposito, p.proveedor,
    p.proveedor_codigo, p.n_remito, p.fecha_remito, p.mes, p.n_oc, p.oc_cargada_dragon,
    p.n_factura, p.fecha_factura, p.factura_link, p.fecha_ingreso, p.fecha_controlada,
    p.dias_atraso, p.estado, p.iva, p.detalle, p.controlado_at,
    (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = p.controlado_por)
  FROM pagina p
$$;
REVOKE ALL ON FUNCTION public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer)
  TO authenticated;

-- =====================================================================
-- Valores para los filtros de la barra
-- =====================================================================
CREATE OR REPLACE FUNCTION public.recepcion_indo_opciones()
RETURNS TABLE (depositos text[], proveedores text[], transportes text[], estados text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    array_agg(DISTINCT deposito ORDER BY deposito) FILTER (WHERE btrim(deposito) <> ''),
    array_agg(DISTINCT proveedor ORDER BY proveedor) FILTER (WHERE btrim(proveedor) <> ''),
    array_agg(DISTINCT transporte ORDER BY transporte) FILTER (WHERE btrim(transporte) <> ''),
    array_agg(DISTINCT estado ORDER BY estado) FILTER (WHERE btrim(estado) <> '')
  FROM public.recepcion_indo r
  WHERE private.tengo_permiso('deposito.view')
$$;
REVOKE ALL ON FUNCTION public.recepcion_indo_opciones() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_opciones() TO authenticated;

-- Proveedores del desplegable: busca en el catálogo. p_buscar vacío devuelve los
-- primeros 300 (el desplegable filtra mientras se escribe).
CREATE OR REPLACE FUNCTION public.recepcion_indo_proveedores(p_buscar text DEFAULT '')
RETURNS TABLE (codigo text, nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.codigo, p.nombre
  FROM public.recepcion_indo_proveedores p
  WHERE private.tengo_permiso('deposito.view')
    AND (
      nullif(btrim(coalesce(p_buscar, '')), '') IS NULL
      OR p.nombre ILIKE '%' || btrim(p_buscar) || '%'
      OR p.codigo ILIKE '%' || btrim(p_buscar) || '%'
    )
  ORDER BY p.nombre
  LIMIT 300
$$;
REVOKE ALL ON FUNCTION public.recepcion_indo_proveedores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_proveedores(text) TO authenticated;

-- =====================================================
--  Checklist en el hub (sin redeploy)
-- =====================================================
--  1. Correr sql/recepcion_indo_proveedores.sql: el catálogo de
--     DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO (1.518 proveedores).
--  2. Entrar a Depósito > Recepción INDO, subir "Recepcion Indo.xlsx" una vez y
--     "Controlar" lo que falte.
--  3. (Opcional) Para que el botón "Actualizar del SQL Server" funcione: habilitar
--     DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO en Configuraciones > Conexión SQL y subir
--     el tope de filas a 2000 (la vista tiene 1.518). No hace falta para usar el módulo.
