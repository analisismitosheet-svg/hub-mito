-- ============================================================================
-- Índice para la campana de notificaciones de los locales
--
-- 26/10/2026: la base del hub (t3.nano) quedó saturada y los syncs del puente
-- morían por statement timeout. En pg_stat_statements la consulta de la campana
-- (transfer_items pendientes de los orígenes del local) sumaba 427.320 llamadas
-- y ~65.000 s, 153 ms de promedio: cada PC de local la corría cada 30 s aunque
-- la pestaña estuviera en segundo plano, y recorría todo el historial del
-- origen para quedarse con los pocos pendientes.
-- La campana ahora solo consulta con la pestaña a la vista y cada 60 s
-- (src/components/CampanaNotificaciones.tsx); este índice cubre solo las filas
-- pendientes, que son pocas.
--
-- Idempotente.
-- ============================================================================

CREATE INDEX IF NOT EXISTS transfer_items_pendientes_origen_idx
  ON public.transfer_items (origen)
  WHERE estado = 'pendiente';
