-- ============================================================
-- FIX: timeout en Reposiciones / Transferencias para roles no-admin
-- ------------------------------------------------------------
-- Síntoma: un usuario con rol 'locales' entra a "/transferencias" y
--   la página queda VACÍA (aunque ve la app y tiene "transferencias.view").
--
-- Causa raíz: la policy de SELECT "titems_view" tenía un solo OR con varias
--   funciones SECURITY DEFINER (es_admin, tiene_permiso x3, mi_local) que
--   PostgreSQL evaluaba POR CADA FILA durante un escaneo completo de la tabla
--   (el OR impedía usar el índice de upper(origen)) -> statement timeout (57014)
--   -> la app no recibía los items -> Transferencias.tsx:462 ocultaba los lotes.
--
-- Solución:
--   1) Índices en transfer_items (incl. índice de expresión upper(origen)).
--   2) Reemplazar la policy titems_view por DOS policies PERMISSIVE:
--        - titems_view_full  : admin / import / ver_todo ("ve todo").
--        - titems_view_local : ve solo filas cuyo origen = su local.
--      Cada policy se planifica por separado; la del local usa el índice
--      de expresión y las funciones costosas se resuelven con subqueries
--      escalares que se evalúan una sola vez por consulta.
-- ============================================================

-- 1. Índices --------------------------------------------------------
CREATE INDEX IF NOT EXISTS transfer_items_lote_id_idx    ON public.transfer_items (lote_id);
CREATE INDEX IF NOT EXISTS transfer_items_lote_orden_idx ON public.transfer_items (lote_id, orden);
CREATE INDEX IF NOT EXISTS transfer_items_origen_idx     ON public.transfer_items (origen);
CREATE INDEX IF NOT EXISTS transfer_items_destino_idx    ON public.transfer_items (destino);
CREATE INDEX IF NOT EXISTS transfer_items_origen_upper_idx ON public.transfer_items (upper(origen));

-- 2. Reescribir RLS de SELECT --------------------------------------
DROP POLICY IF EXISTS titems_view ON public.transfer_items;

-- A) "Ve todo": admin o permiso de import / ver_todo (subquery escalar única)
CREATE POLICY titems_view_full ON public.transfer_items AS PERMISSIVE FOR SELECT TO public
USING (
  (SELECT bool_or(
     r.es_admin OR u.es_admin OR
     rp.permiso_clave IN ('transferencias.import','transferencias.ver_todo')
   )
   FROM public.usuarios u
   LEFT JOIN public.roles r ON r.codigo = u.rol
   LEFT JOIN public.usuario_roles ur ON ur.usuario_id = u.id
   LEFT JOIN public.rol_permisos rp ON rp.rol = ur.rol_codigo
   WHERE u.id = auth.uid())
);

-- B) "Ve lo de su local": usa el índice de expresión upper(origen)
CREATE POLICY titems_view_local ON public.transfer_items AS PERMISSIVE FOR SELECT TO public
USING (
  upper(origen) = upper(COALESCE((SELECT u.local FROM public.usuarios u WHERE u.id = auth.uid()), ''))
);
