-- =====================================================
-- PICKING (Depósito): ingreso físico de los pedidos de compra
-- Ejecutar en Supabase SQL Editor. Idempotente.
--
-- Por cada artículo de un pedido de compra (pedidos_compra_items, copia de Dragonfish) se anota
-- cuántas unidades llegaron físicamente. La clave es pedido + artículo + color + talle (no el
-- número de renglón): la copia horaria reescribe los renglones y el orden puede cambiar.
-- Permiso: picking.view (ver y marcar). Los renglones de servicios (F = flete) no se muestran.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.picking_compra (
  codigo          text NOT NULL,                -- pedidos_compra.codigo
  articulo        text NOT NULL,
  color           text NOT NULL DEFAULT '',
  talle           text NOT NULL DEFAULT '',
  recibido        numeric NOT NULL DEFAULT 0 CHECK (recibido >= 0),
  actualizado_por uuid DEFAULT auth.uid(),
  actualizado_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (codigo, articulo, color, talle)
);

-- ---- Permiso + roles ----
INSERT INTO public.permisos (clave, modulo, accion, label, orden) VALUES
  ('picking.view', 'deposito', 'view', 'Picking: ver y marcar el ingreso de pedidos de compra', 872)
ON CONFLICT (clave) DO NOTHING;
INSERT INTO public.rol_permisos (rol, permiso_clave)
SELECT r.rol, 'picking.view'
FROM (VALUES ('deposito'), ('compras')) AS r(rol)
WHERE NOT EXISTS (SELECT 1 FROM public.rol_permisos WHERE rol = r.rol AND permiso_clave = 'picking.view');

-- ---- RLS ----
ALTER TABLE public.picking_compra ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.picking_compra FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.picking_compra TO authenticated;

DROP POLICY IF EXISTS picking_compra_ver ON public.picking_compra;
CREATE POLICY picking_compra_ver ON public.picking_compra
  FOR SELECT TO authenticated USING (private.tengo_permiso('picking.view'));
DROP POLICY IF EXISTS picking_compra_alta ON public.picking_compra;
CREATE POLICY picking_compra_alta ON public.picking_compra
  FOR INSERT TO authenticated WITH CHECK (private.tengo_permiso('picking.view'));
DROP POLICY IF EXISTS picking_compra_cambio ON public.picking_compra;
CREATE POLICY picking_compra_cambio ON public.picking_compra
  FOR UPDATE TO authenticated USING (private.tengo_permiso('picking.view'))
  WITH CHECK (private.tengo_permiso('picking.view'));

-- Quién y cuándo: siempre el usuario de la sesión (no lo que mande el navegador)
CREATE OR REPLACE FUNCTION private.picking_compra_firma()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.actualizado_por := auth.uid();
  NEW.actualizado_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS picking_compra_firma ON public.picking_compra;
CREATE TRIGGER picking_compra_firma BEFORE INSERT OR UPDATE ON public.picking_compra
  FOR EACH ROW EXECUTE FUNCTION private.picking_compra_firma();

-- ---- Pedidos de compra del picking (avance por pedido) ----
-- Corre como el dueño y filtra por picking.view: así el depósito no necesita el permiso de Compras
-- (pedidos_compra.view) para ver los pedidos.
CREATE OR REPLACE FUNCTION public.picking_pedidos()
RETURNS TABLE (codigo text, numero integer, descripcion text, fecha date, proveedor text, proveedor_nombre text,
               anulado boolean, unidades numeric, recibidas numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT i.codigo, upper(trim(i.articulo)) AS articulo, coalesce(trim(i.color), '') AS color,
           coalesce(trim(i.talle), '') AS talle, sum(coalesce(i.cantidad, 0)) AS cantidad
    FROM public.pedidos_compra_items i
    WHERE coalesce(trim(i.articulo), '') <> ''
      AND upper(trim(i.articulo)) NOT IN ('F')  -- F = flete (servicio, no mercadería)
    GROUP BY 1, 2, 3, 4
  )
  SELECT p.codigo, p.numero, p.descripcion, p.fecha, p.proveedor, p.proveedor_nombre, p.anulado,
         coalesce(sum(it.cantidad), 0),
         coalesce(sum(least(coalesce(k.recibido, 0), it.cantidad)), 0)
  FROM public.pedidos_compra p
  LEFT JOIN it ON it.codigo = p.codigo
  LEFT JOIN public.picking_compra k
    ON k.codigo = it.codigo AND k.articulo = it.articulo AND k.color = it.color AND k.talle = it.talle
  WHERE private.tengo_permiso('picking.view')
  GROUP BY p.codigo, p.numero, p.descripcion, p.fecha, p.proveedor, p.proveedor_nombre, p.anulado
$$;

-- Artículos de un pedido (agrupados por artículo/color/talle) con lo recibido
CREATE OR REPLACE FUNCTION public.picking_items(p_codigo text)
RETURNS TABLE (articulo text, color text, talle text, cantidad numeric, recibido numeric,
               actualizado_at timestamptz, actualizado_por text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT upper(trim(i.articulo)) AS articulo, coalesce(trim(i.color), '') AS color,
           coalesce(trim(i.talle), '') AS talle, sum(coalesce(i.cantidad, 0)) AS cantidad, min(i.linea) AS linea
    FROM public.pedidos_compra_items i
    WHERE i.codigo = p_codigo AND coalesce(trim(i.articulo), '') <> ''
      AND upper(trim(i.articulo)) NOT IN ('F')  -- F = flete (servicio, no mercadería)
    GROUP BY 1, 2, 3
  )
  SELECT it.articulo, it.color, it.talle, it.cantidad, coalesce(k.recibido, 0), k.actualizado_at,
         (SELECT coalesce(nullif(trim(pr.nombre), ''), pr.email) FROM public.usuarios pr WHERE pr.id = k.actualizado_por)
  FROM it
  LEFT JOIN public.picking_compra k
    ON k.codigo = p_codigo AND k.articulo = it.articulo AND k.color = it.color AND k.talle = it.talle
  WHERE private.tengo_permiso('picking.view')
  ORDER BY it.linea
$$;

REVOKE ALL ON FUNCTION public.picking_pedidos() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.picking_items(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picking_pedidos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.picking_items(text) TO authenticated;

-- Por artículo: todos los pedidos (no anulados) que tienen ese artículo, del más viejo al más nuevo.
-- p_articulo es el código o el principio del código (mínimo 3 caracteres).
CREATE OR REPLACE FUNCTION public.picking_articulo(p_articulo text)
RETURNS TABLE (codigo text, numero integer, descripcion text, fecha date, proveedor text, proveedor_nombre text,
               articulo text, color text, talle text, cantidad numeric, recibido numeric,
               actualizado_at timestamptz, actualizado_por text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT i.codigo, upper(trim(i.articulo)) AS articulo, coalesce(trim(i.color), '') AS color,
           coalesce(trim(i.talle), '') AS talle, sum(coalesce(i.cantidad, 0)) AS cantidad, min(i.linea) AS linea
    FROM public.pedidos_compra_items i
    WHERE length(trim(coalesce(p_articulo, ''))) >= 3
      AND upper(trim(i.articulo)) NOT IN ('F')  -- F = flete (servicio, no mercadería)
      AND upper(trim(i.articulo)) LIKE upper(replace(replace(trim(p_articulo), '%', ''), '_', '')) || '%'
    GROUP BY 1, 2, 3, 4
  )
  SELECT p.codigo, p.numero, p.descripcion, p.fecha, p.proveedor, p.proveedor_nombre,
         it.articulo, it.color, it.talle, it.cantidad, coalesce(k.recibido, 0), k.actualizado_at,
         (SELECT coalesce(nullif(trim(u.nombre), ''), u.email) FROM public.usuarios u WHERE u.id = k.actualizado_por)
  FROM it
  JOIN public.pedidos_compra p ON p.codigo = it.codigo AND NOT p.anulado
  LEFT JOIN public.picking_compra k
    ON k.codigo = it.codigo AND k.articulo = it.articulo AND k.color = it.color AND k.talle = it.talle
  WHERE private.tengo_permiso('picking.view')
  ORDER BY it.articulo, it.color, it.talle, p.fecha, p.numero, it.linea
  LIMIT 2000
$$;
REVOKE ALL ON FUNCTION public.picking_articulo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picking_articulo(text) TO authenticated;

COMMIT;

-- Todos los renglones de los pedidos no anulados con lo recibido (para importar el Excel de ingresos
-- del picking desde el hub: el navegador cruza y marca). Ordenado para poder paginar de a 1000.
CREATE OR REPLACE FUNCTION public.picking_items_todos()
RETURNS TABLE (codigo text, descripcion text, articulo text, color text, talle text, cantidad numeric, recibido numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT i.codigo, upper(trim(i.articulo)) AS articulo, coalesce(trim(i.color), '') AS color,
           coalesce(trim(i.talle), '') AS talle, sum(coalesce(i.cantidad, 0)) AS cantidad, min(i.linea) AS linea
    FROM public.pedidos_compra_items i
    WHERE coalesce(trim(i.articulo), '') <> '' AND upper(trim(i.articulo)) NOT IN ('F')
    GROUP BY 1, 2, 3, 4
  )
  SELECT it.codigo, p.descripcion, it.articulo, it.color, it.talle, it.cantidad, coalesce(k.recibido, 0)
  FROM it
  JOIN public.pedidos_compra p ON p.codigo = it.codigo AND NOT p.anulado
  LEFT JOIN public.picking_compra k
    ON k.codigo = it.codigo AND k.articulo = it.articulo AND k.color = it.color AND k.talle = it.talle
  WHERE private.tengo_permiso('picking.view')
  ORDER BY it.codigo, it.linea, it.articulo, it.color, it.talle
$$;
REVOKE ALL ON FUNCTION public.picking_items_todos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.picking_items_todos() TO authenticated;
