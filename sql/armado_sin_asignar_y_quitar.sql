-- ============================================================================
-- Armados: sin asignación automática + "Sacar armado" (solo admin)
--
-- Aplicado en Supabase (migración armado_sin_asignar_y_quitar). Idempotente.
--
-- Decisión 08/10/2026: gana el legajo que lo acepta. Ya no se asigna solo al
-- responsable del local (se saca el trigger de sql/armado_responsable.sql y se
-- limpia la asignación de los pendientes): el armado le llega a todo el piso y
-- el primero que toca Acepto se lo queda.
--
-- armado_quitar(p_id): el admin borra un armado pedido (con sus ítems). El
-- pedido vuelve a como estaba (si es VTD, muestra su repo). pedidos_venta_estado
-- se recalcula solo por el trigger de mayorista_armados.
-- ============================================================================

DROP TRIGGER IF EXISTS mayorista_armados_responsable ON public.mayorista_armados;

UPDATE public.mayorista_armados
   SET asignado_empleado_id = NULL, asignado_legajo = NULL, asignado_nombre = NULL, asignado_local = NULL
 WHERE estado = 'pendiente' AND asignado_legajo IS NOT NULL;

CREATE OR REPLACE FUNCTION public.armado_quitar(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.es_admin() THEN
    RAISE EXCEPTION 'Solo el administrador puede sacar un armado' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.mayorista_armados WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese armado ya no existe' USING ERRCODE = 'P0002'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.armado_quitar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.armado_quitar(uuid) TO authenticated;
