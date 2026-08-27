-- ============================================================================
-- MIGRACIÓN RBAC — 2/2 POLICIES RLS sobre facturacion_fabrica
-- IMPLEMENTA LAS REGLAS A, B y C EN LA CAPA DE BASE DE DATOS (no-bypasseable).
--
-- Usa los helpers definidos en rbac_schema.sql:
--   public.app_es_mayorista()  -> true si el usuario es mayorista o admin
--   public.app_es_polo52()     -> true si el usuario tiene rol polo52
--
-- Ejecutar DESPUÉS de `rbac_schema.sql`. IDEMPOTENTE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- REGLA A — SELECT (visibilidad)
-- Mayorista: ve TODO (sin filtro extra).
-- Polo52:    WHERE (polo = 'A POLO52' OR created_by = auth.uid()).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "facturacion_select_mayorista" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_select_mayorista" ON public.facturacion_fabrica
  FOR SELECT USING (public.app_es_mayorista());

DROP POLICY IF EXISTS "facturacion_select_polo52" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_select_polo52" ON public.facturacion_fabrica
  FOR SELECT USING (
    public.app_es_polo52()
    AND (polo = 'A POLO52' OR created_by = auth.uid())
  );

ALTER TABLE public.facturacion_fabrica ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- REGLA B — INSERT (creación)
-- Mayorista: polo puede quedar NULL o elegir a qué local derivar.
-- Polo52:    backend FUERZA polo = 'A POLO52' y created_by = auth.uid().
--            RLS ignora/valida lo que mande el cliente.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "facturacion_insert_mayorista" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_insert_mayorista" ON public.facturacion_fabrica
  FOR INSERT WITH CHECK (public.app_es_mayorista());

DROP POLICY IF EXISTS "facturacion_insert_polo52" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_insert_polo52" ON public.facturacion_fabrica
  FOR INSERT WITH CHECK (
    public.app_es_polo52()
    AND polo = 'A POLO52'
    AND created_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- REGLA C — UPDATE / DELETE (marcar Preparado/Faltante, edición)
-- Mayorista: sobre CUALQUIER fila.
-- Polo52:    SOLO filas que le pertenecen (created_by = auth.uid()).
--            Si intenta tocar otra -> RLS rechaza -> PostgREST 403.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "facturacion_update_mayorista" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_update_mayorista" ON public.facturacion_fabrica
  FOR UPDATE USING (public.app_es_mayorista())
  WITH CHECK (public.app_es_mayorista());

DROP POLICY IF EXISTS "facturacion_update_polo52" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_update_polo52" ON public.facturacion_fabrica
  FOR UPDATE USING (
    public.app_es_polo52() AND created_by = auth.uid()
  ) WITH CHECK (
    public.app_es_polo52()
    AND created_by = auth.uid()
    AND polo = 'A POLO52'
  );

DROP POLICY IF EXISTS "facturacion_delete_mayorista" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_delete_mayorista" ON public.facturacion_fabrica
  FOR DELETE USING (public.app_es_mayorista());

DROP POLICY IF EXISTS "facturacion_delete_polo52" ON public.facturacion_fabrica;
CREATE POLICY "facturacion_delete_polo52" ON public.facturacion_fabrica
  FOR DELETE USING (
    public.app_es_polo52() AND created_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Índices de soporte
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_facturacion_polo ON public.facturacion_fabrica (polo);
CREATE INDEX IF NOT EXISTS idx_facturacion_created_by ON public.facturacion_fabrica (created_by);
