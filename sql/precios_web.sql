-- =====================================================
-- COMPARATIVA DE PRECIOS (Compras): mis precios contra la web de la marca
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- precios_web        lo que leyó /api/precios-sync de la web de la marca por código
-- precios_web_sync   última lectura y por dónde va (el sync corre por tandas: una
--                    función de Vercel corta a los 60 s y son ~1700 códigos)
-- vw_comparativa_precios  articulos (código de la marca sacado de la descripción) x precios_web
--
-- La vista y precios_web_codigos manejan la marca por configuración (patrón de código +
-- filtros de descripción por marca). Vans es la única activa: converse y topper están
-- documentadas abajo (converse: patrón NNNNNNB, pero su web no publica precios).
--
-- La comparación es MI PRECIO PÚBLICO contra el PRECIO DE LISTA de la marca (antes de
-- la oferta). El precio vigente y el % OFF se muestran como dato.
--
-- Escritura: solo por las RPC de abajo, que aceptan un admin logueado o la clave de
-- sync 'precios' (private.sync_claves, hash sha256), así no hace falta service role.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.precios_web (
  marca        text NOT NULL,
  cod          text NOT NULL,          -- código como está en la descripción
  cod_web      text,                   -- código con el que lo encontró la web (sin sufijo)
  nombre_web   text,
  precio       numeric,                -- precio de venta vigente
  precio_lista numeric,                -- antes del descuento (= precio si no hay oferta)
  desc_pct     integer,
  con_stock    boolean,
  url          text,
  encontrado   boolean NOT NULL DEFAULT false,
  leido_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (marca, cod)
);

CREATE TABLE IF NOT EXISTS public.precios_web_sync (
  marca        text PRIMARY KEY,
  ultima_at    timestamptz,            -- fin de la última lectura completa
  consultados  integer NOT NULL DEFAULT 0,
  encontrados  integer NOT NULL DEFAULT 0,
  errores      integer NOT NULL DEFAULT 0,
  inicio_at    timestamptz,            -- arranque de la lectura en curso
  proximo      integer,                -- índice del próximo código; null = no hay lectura en curso
  total        integer                 -- códigos a leer en la lectura en curso
);

-- ---- Permiso + roles (administrador ya ve todo por es_admin; se asigna igual por las dudas) ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('compras_precios.view', 'compras', 'view', 'Ver comparativa de precios', 880)
ON CONFLICT (clave) DO NOTHING;
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT r.rol, 'compras_precios.view'
FROM (VALUES ('administrador'), ('compras')) AS r(rol)
WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = r.rol AND permiso_clave = 'compras_precios.view');

-- ---- RLS: lectura con permiso; escritura solo por RPC ----
ALTER TABLE public.precios_web ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios_web_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.precios_web, public.precios_web_sync FROM anon, authenticated;
GRANT SELECT ON public.precios_web, public.precios_web_sync TO authenticated;
DROP POLICY IF EXISTS precios_web_ver ON public.precios_web;
CREATE POLICY precios_web_ver ON public.precios_web FOR SELECT TO authenticated
  USING (private.tengo_permiso('compras_precios.view'));
DROP POLICY IF EXISTS precios_web_sync_ver ON public.precios_web_sync;
CREATE POLICY precios_web_sync_ver ON public.precios_web_sync FOR SELECT TO authenticated
  USING (private.tengo_permiso('compras_precios.view'));

-- ---- Vista ----
-- security_invoker: respeta la RLS de precios_web (articulos se lee libre).
-- Un código puede estar en varios id_art: una fila por id_art.
-- Cada marca define su patrón de código sobre la descripción y qué descripciones
-- son suyas (busca; word es un filtro extra de marca). Una marca entra a la vista
-- aunque su web todavía no devuelva nada, porque el cruce es contra precios_web.
CREATE OR REPLACE VIEW public.vw_comparativa_precios WITH (security_invoker = true) AS
WITH marcas AS (
  SELECT * FROM (VALUES
    ('vans',     '(?i)VN0[A-Za-z0-9]{6,10}', '%VN0%',      NULL::text),
    ('converse', '([0-9]{6}B)',              '%B%',        '%CONVERSE%')
  ) AS m(marca, patron, busca, word)
), a AS (
  SELECT m.marca,
         upper(substring(ar.descripcion FROM m.patron)) AS cod,
         ar.id_art, ar.descripcion, ar.id_flia AS familia, ar.anio, ar.publicado,
         ar.precio_publico AS mi_precio
  FROM public.articulos ar
  JOIN marcas m
    ON ar.descripcion ILIKE m.busca
   AND (m.word IS NULL OR ar.descripcion ILIKE m.word)
), c AS (
  SELECT a.*, p.precio, p.precio_lista, p.desc_pct, p.con_stock, p.url,
         p.nombre_web, p.leido_at,
         a.mi_precio - p.precio_lista AS dif
  FROM a JOIN public.precios_web p ON p.marca = a.marca AND p.cod = a.cod AND p.encontrado
)
SELECT c.cod AS codigo, c.id_art, c.descripcion, c.familia, c.anio, c.publicado, c.marca,
       c.mi_precio, c.precio, c.precio_lista, c.desc_pct, c.con_stock, c.url, c.nombre_web, c.leido_at,
       c.dif,
       CASE WHEN c.precio_lista > 0 THEN round(c.dif / c.precio_lista, 4) END AS dif_pct,
       CASE
         WHEN coalesce(c.mi_precio, 0) = 0 THEN 'sin_precio'
         WHEN c.mi_precio < 10000 OR c.precio_lista < 10000 OR c.precio < 10000 THEN 'revisar'
         WHEN abs(c.dif / c.precio_lista) <= 0.02 THEN 'igual'
         WHEN c.dif > 0 THEN 'mas_caro'
         ELSE 'mas_barato'
       END AS estado
FROM c;
GRANT SELECT ON public.vw_comparativa_precios TO authenticated;
REVOKE ALL ON public.vw_comparativa_precios FROM anon;

-- ---- RPC del sync ----
CREATE OR REPLACE FUNCTION private.precios_sync_ok(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.es_admin() OR private.clave_sync_ok('precios', p_token)
$$;

-- Códigos a leer (ordenados, sin repetir) sacados de la descripción de los artículos.
-- Cada marca define su patrón + filtros, igual que la vista (ver arriba).
CREATE OR REPLACE FUNCTION public.precios_web_codigos(p_marca text, p_token text DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_patron text;
  v_busca  text;
  v_word   text;
BEGIN
  IF NOT private.precios_sync_ok(p_token) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT (CASE p_marca
            WHEN 'vans'     THEN '(?i)VN0[A-Za-z0-9]{6,10}'
            WHEN 'converse' THEN '([0-9]{6}B)'
          END),
         (CASE p_marca WHEN 'vans' THEN '%VN0%' WHEN 'converse' THEN '%B%' END),
         (CASE p_marca WHEN 'vans' THEN NULL::text WHEN 'converse' THEN '%CONVERSE%' END)
    INTO v_patron, v_busca, v_word;
  IF v_patron IS NULL THEN RAISE EXCEPTION 'Marca no soportada: %', p_marca; END IF;
  RETURN ARRAY(
    SELECT DISTINCT upper(substring(descripcion FROM v_patron)) AS c
    FROM public.articulos
    WHERE descripcion ILIKE v_busca
      AND (v_word IS NULL OR descripcion ILIKE v_word)
    ORDER BY 1);
END $$;

-- Guarda una tanda. p_desde = índice del primer código de la tanda (0 = lectura nueva),
-- p_hasta = índice siguiente al último leído, p_total = cantidad de códigos.
CREATE OR REPLACE FUNCTION public.precios_web_guardar(
  p_marca text, p_filas jsonb, p_desde integer, p_hasta integer, p_total integer,
  p_errores integer DEFAULT 0, p_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_enc integer;
  v_fin boolean := p_hasta >= p_total;
BEGIN
  IF NOT private.precios_sync_ok(p_token) THEN RAISE EXCEPTION 'No autorizado'; END IF;

  INSERT INTO public.precios_web AS w (marca, cod, cod_web, nombre_web, precio, precio_lista,
                                       desc_pct, con_stock, url, encontrado, leido_at)
  SELECT p_marca, f.cod, f.cod_web, f.nombre_web, f.precio, f.precio_lista, f.desc_pct,
         f.con_stock, f.url, coalesce(f.encontrado, false), now()
  FROM jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) AS f(
    cod text, cod_web text, nombre_web text, precio numeric, precio_lista numeric,
    desc_pct integer, con_stock boolean, url text, encontrado boolean)
  WHERE coalesce(f.cod, '') <> ''
  ON CONFLICT (marca, cod) DO UPDATE SET
    cod_web = EXCLUDED.cod_web, nombre_web = EXCLUDED.nombre_web, precio = EXCLUDED.precio,
    precio_lista = EXCLUDED.precio_lista, desc_pct = EXCLUDED.desc_pct,
    con_stock = EXCLUDED.con_stock, url = EXCLUDED.url, encontrado = EXCLUDED.encontrado,
    leido_at = EXCLUDED.leido_at;

  SELECT count(*) INTO v_enc FROM jsonb_to_recordset(coalesce(p_filas, '[]'::jsonb)) AS f(encontrado boolean)
  WHERE f.encontrado;

  INSERT INTO public.precios_web_sync (marca) VALUES (p_marca) ON CONFLICT (marca) DO NOTHING;
  IF p_desde = 0 THEN
    UPDATE public.precios_web_sync SET inicio_at = now(), consultados = 0, encontrados = 0,
      errores = 0, total = p_total WHERE marca = p_marca;
  END IF;
  UPDATE public.precios_web_sync SET
    consultados = consultados + jsonb_array_length(coalesce(p_filas, '[]'::jsonb)) + coalesce(p_errores, 0),
    encontrados = encontrados + v_enc,
    errores     = errores + coalesce(p_errores, 0),
    total       = p_total,
    proximo     = CASE WHEN v_fin THEN NULL ELSE p_hasta END,
    ultima_at   = CASE WHEN v_fin THEN now() ELSE ultima_at END
  WHERE marca = p_marca;

  RETURN (SELECT to_jsonb(s) FROM public.precios_web_sync s WHERE s.marca = p_marca);
END $$;

REVOKE ALL ON FUNCTION public.precios_web_codigos(text, text) FROM public;
REVOKE ALL ON FUNCTION public.precios_web_guardar(text, jsonb, integer, integer, integer, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.precios_web_codigos(text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.precios_web_guardar(text, jsonb, integer, integer, integer, integer, text) TO authenticated, anon;
-- (anon: el cron llama sin sesión y se valida con la clave de sync dentro de la función)
