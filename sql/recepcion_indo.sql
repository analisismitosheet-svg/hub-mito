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
-- ---- Orden por estado (aplicado en la migración recepcion_indo_orden_estado) ----
-- "Listo para controlar" arriba, después "En depósito", después el resto.
CREATE OR REPLACE FUNCTION private.recepcion_indo_orden_estado(p_estado text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN translate(upper(btrim(coalesce(p_estado, ''))), 'ÁÉÍÓÚ', 'AEIOU') LIKE 'LISTO PARA CONTROL%' THEN 0
    WHEN translate(upper(btrim(coalesce(p_estado, ''))), 'ÁÉÍÓÚ', 'AEIOU') LIKE 'EN DEPOSITO%' THEN 1
    ELSE 2
  END
$$;

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
    fecha_ingreso, fecha_controlada, estado, iva, detalle, importado_at, importado_por
  )
  SELECT
    upper(btrim(coalesce(x->>'clave', ''))),
    btrim(coalesce(x->>'nGuia', '')),
    -- en mayúsculas y sin espacios dobles: "ag" / "AG" eran dos transportes en el desplegable
    upper(regexp_replace(btrim(coalesce(x->>'transporte', '')), '\s+', ' ', 'g')),
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
    nullif(btrim(coalesce(x->>'detalle', '')), ''),
    now(),
    auth.uid()
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
    -- si el Excel trae la OC vacía, se conserva la elegida en el hub (buscador de la columna N° OC)
    n_oc              = CASE WHEN btrim(EXCLUDED.n_oc) = '' THEN t.n_oc ELSE EXCLUDED.n_oc END,
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
    -- Primero "Listo para controlar", después "En depósito", después el resto
    ORDER BY private.recepcion_indo_orden_estado(f.estado), f.fecha_ingreso DESC NULLS LAST, f.n_guia, f.clave
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
--     DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO en Configuraciones > Conexión SQL. Con el
--     tope de filas actual (29 900 000) no hay que tocar nada: son 1.518. No hace falta
--     para usar el módulo.

-- =====================================================
-- Recepción completa = cerrada (2026-10-07): con todas las columnas cargadas (el link de Drive y el
-- detalle son opcionales) solo se puede cambiar el detalle. Los administradores pueden todo.
-- La pantalla aplica la misma regla (función completa() en RecepcionIndo.tsx).
-- =====================================================
CREATE OR REPLACE FUNCTION private.recepcion_indo_completa(r public.recepcion_indo)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(coalesce(r.n_guia, '')) <> '' AND btrim(coalesce(r.transporte, '')) <> '' AND coalesce(r.bultos, 0) > 0
     AND btrim(coalesce(r.deposito, '')) <> '' AND btrim(coalesce(r.proveedor, '')) <> ''
     AND btrim(coalesce(r.n_remito, '')) <> '' AND r.fecha_remito IS NOT NULL AND btrim(coalesce(r.n_oc, '')) <> ''
     AND btrim(coalesce(r.n_factura, '')) <> '' AND r.fecha_factura IS NOT NULL AND r.fecha_ingreso IS NOT NULL
     AND btrim(coalesce(r.estado, '')) <> '' AND r.iva IS NOT NULL AND r.fecha_controlada IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.recepcion_indo_bloqueo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_detalle text := NEW.detalle;
BEGIN
  IF private.recepcion_indo_completa(OLD) AND NOT coalesce(private.es_admin(), false) THEN
    NEW := OLD;               -- cerrada: se descarta todo cambio (también el de una reimportación del Excel)…
    NEW.detalle := v_detalle; -- …menos el detalle
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recepcion_indo_bloqueo ON public.recepcion_indo;
CREATE TRIGGER recepcion_indo_bloqueo BEFORE UPDATE ON public.recepcion_indo
  FOR EACH ROW EXECUTE FUNCTION private.recepcion_indo_bloqueo();

-- 2026-10-07 (cambio de regla, pedido del usuario): se cierra cuando tiene fecha de control,
-- no cuando están todas las columnas completas.
CREATE OR REPLACE FUNCTION private.recepcion_indo_completa(r public.recepcion_indo)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT r.fecha_controlada IS NOT NULL
$$;

-- 2026-10-07: el catálogo de proveedores lo actualiza solo el puente SQL cada 1 hora
-- (puente-sql/scripts/sync-pedidos-compra.js lee DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO). Solo agrega/actualiza.
CREATE OR REPLACE FUNCTION public.recepcion_indo_proveedores_sync(p_token text, p_filas jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT private.clave_sync_ok('puente', p_token) THEN
    RAISE EXCEPTION 'Clave de sincronización inválida' USING ERRCODE = '28000';
  END IF;
  IF jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 OR jsonb_array_length(p_filas) > 20000 THEN
    RAISE EXCEPTION 'Catálogo inválido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.recepcion_indo_proveedores AS p (codigo, nombre, actualizado_at)
  SELECT DISTINCT ON (trim(f->>'codigo')) trim(f->>'codigo'), trim(f->>'nombre'), now()
  FROM jsonb_array_elements(p_filas) f
  WHERE coalesce(trim(f->>'codigo'), '') <> '' AND coalesce(trim(f->>'nombre'), '') <> ''
  ON CONFLICT (codigo) DO UPDATE
    SET nombre = excluded.nombre, actualizado_at = now()
    WHERE p.nombre IS DISTINCT FROM excluded.nombre;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.recepcion_indo_proveedores_sync(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_proveedores_sync(text, jsonb) TO anon, authenticated;

-- =====================================================
-- Filas con errores (filtro "Con errores" de la pantalla)
-- =====================================================
CREATE OR REPLACE FUNCTION private.compacto(v text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(upper(translate(coalesce(v, ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU')), '[^A-Z0-9]', '', 'g')
$$;
ALTER TABLE public.recepcion_indo_proveedores
  ADD COLUMN IF NOT EXISTS nombre_compacto text GENERATED ALWAYS AS (private.compacto(nombre)) STORED;

-- Lista de problemas de una fila: 'Falta: …', 'Proveedor fuera del catálogo', 'OC inexistente: …',
-- 'Ingreso anterior al remito', 'Control anterior al ingreso'. Lo del proveedor llega calculado
-- (recepcion_indo_filas lo calcula una vez por proveedor distinto: por fila tardaba 24 s).
DROP FUNCTION IF EXISTS private.recepcion_indo_errores(public.recepcion_indo);
CREATE OR REPLACE FUNCTION private.recepcion_indo_errores(r public.recepcion_indo, p_proveedor_fuera boolean)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH faltan AS (
    SELECT string_agg(campo, ', ' ORDER BY orden) AS lista FROM (VALUES
      (1, 'guía', btrim(coalesce(r.n_guia, '')) = ''),
      (2, 'transporte', btrim(coalesce(r.transporte, '')) = ''),
      (3, 'bultos', coalesce(r.bultos, 0) <= 0),
      (4, 'depósito', btrim(coalesce(r.deposito, '')) = ''),
      (5, 'proveedor', btrim(coalesce(r.proveedor, '')) = ''),
      (6, 'remito', btrim(coalesce(r.n_remito, '')) = ''),
      (7, 'fecha remito', r.fecha_remito IS NULL),
      (8, 'OC', btrim(coalesce(r.n_oc, '')) = ''),
      (9, 'factura', btrim(coalesce(r.n_factura, '')) = ''),
      (10, 'fecha factura', r.fecha_factura IS NULL),
      (11, 'fecha ingreso', r.fecha_ingreso IS NULL),
      (12, 'estado', btrim(coalesce(r.estado, '')) = ''),
      (13, 'IVA', r.iva IS NULL)
    ) x(orden, campo, falta) WHERE falta
  ), oc_mal AS (
    -- El listado de OC (VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA) arranca en 2025: antes no se puede validar
    SELECT string_agg(o, ', ') AS lista
    FROM unnest(regexp_split_to_array(coalesce(r.n_oc, ''), '[/;,]')) AS t(o0)
    CROSS JOIN LATERAL (SELECT btrim(o0) AS o) z
    WHERE o <> '' AND coalesce(r.fecha_ingreso, r.fecha_remito, DATE '2025-01-01') >= DATE '2025-01-01'
      AND NOT EXISTS (SELECT 1 FROM public.pedidos_compra_oc c WHERE c.numero::text = o)
  )
  SELECT array_remove(ARRAY[
    CASE WHEN (SELECT lista FROM faltan) IS NOT NULL THEN 'Falta: ' || (SELECT lista FROM faltan) END,
    CASE WHEN p_proveedor_fuera THEN 'Proveedor fuera del catálogo' END,
    CASE WHEN (SELECT lista FROM oc_mal) IS NOT NULL THEN 'OC inexistente: ' || (SELECT lista FROM oc_mal) END,
    CASE WHEN r.fecha_ingreso < r.fecha_remito THEN 'Ingreso anterior al remito' END,
    CASE WHEN r.fecha_controlada < r.fecha_ingreso THEN 'Control anterior al ingreso' END
  ], NULL)
$$;

-- recepcion_indo_filas con p_control 'errores' / 'errores_pendientes' y la columna errores
DROP FUNCTION IF EXISTS public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer);
CREATE FUNCTION public.recepcion_indo_filas(p_deposito text DEFAULT ''::text, p_proveedor text DEFAULT ''::text, p_transporte text DEFAULT ''::text, p_estado text DEFAULT ''::text, p_control text DEFAULT ''::text, p_busqueda text DEFAULT ''::text, p_desde integer DEFAULT 0, p_limite integer DEFAULT 200)
 RETURNS TABLE(total bigint, clave text, n_guia text, transporte text, bultos integer, deposito text, proveedor text, proveedor_codigo text, n_remito text, fecha_remito date, mes integer, n_oc text, oc_cargada_dragon boolean, n_factura text, fecha_factura date, factura_link text, fecha_ingreso date, fecha_controlada date, dias_atraso integer, estado text, iva numeric, detalle text, controlado_at timestamp with time zone, controlado_por text, errores text[])
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH base AS (
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
        OR p_control = 'errores'
        OR (p_control = 'errores_pendientes' AND r.fecha_controlada IS NULL)
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
  ), pv AS MATERIALIZED (
    -- Proveedor fuera del catálogo: una vez por proveedor distinto (~110), no por fila.
    -- Alcanza con que un nombre contenga al otro ("GRIMOLDI S.A." y "GRIMOLDI SA (VANS)").
    SELECT d.proveedor, length(d.c) >= 3 AND NOT EXISTS (
             SELECT 1 FROM public.recepcion_indo_proveedores p
              WHERE p.nombre_compacto = d.c
                 OR (length(d.c) >= 4 AND (strpos(p.nombre_compacto, d.c) > 0
                                           OR (length(p.nombre_compacto) >= 4 AND strpos(d.c, p.nombre_compacto) > 0)))) AS fuera
    FROM (SELECT DISTINCT b.proveedor, private.compacto(b.proveedor) AS c FROM base b) d
  ), f AS (
    SELECT b.*, private.recepcion_indo_errores(b::public.recepcion_indo, coalesce(pv.fuera, false)) AS errs
    FROM base b LEFT JOIN pv ON pv.proveedor IS NOT DISTINCT FROM b.proveedor
  ), pagina AS (
    SELECT f.*, count(*) OVER () AS total
    FROM f
    WHERE coalesce(p_control, '') NOT IN ('errores', 'errores_pendientes') OR cardinality(f.errs) > 0
    -- Primero "Listo para controlar", después "En depósito", después el resto
    ORDER BY private.recepcion_indo_orden_estado(f.estado), f.fecha_ingreso DESC NULLS LAST, f.n_guia, f.clave
    LIMIT greatest(1, least(coalesce(p_limite, 200), 1000))
    OFFSET greatest(0, coalesce(p_desde, 0))
  )
  SELECT
    p.total, p.clave, p.n_guia, p.transporte, p.bultos, p.deposito, p.proveedor,
    p.proveedor_codigo, p.n_remito, p.fecha_remito, p.mes, p.n_oc, p.oc_cargada_dragon,
    p.n_factura, p.fecha_factura, p.factura_link, p.fecha_ingreso, p.fecha_controlada,
    p.dias_atraso, p.estado, p.iva, p.detalle, p.controlado_at,
    (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = p.controlado_por),
    p.errs
  FROM pagina p
$function$;
GRANT EXECUTE ON FUNCTION public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.recepcion_indo_filas(text, text, text, text, text, text, integer, integer) FROM anon, public;

