-- ============================================================================
-- Avisos de FALTANTES DE STOCK al cerrar un armado
--
-- Aplicado en Supabase (migración armado_faltantes_aviso). Idempotente.
--
-- Cuando el legajo toca "Finalizar" y quedaron faltantes, los renglones que
-- faltaron se cierran SOLOS como 'faltante' (armado_finalizar) y el mayorista
-- debe enterarse. Este permiso es quien lo recibe:
--
--   mayorista.faltantes.ver  -> ve en la campana los armados cerrados con
--                               faltantes de stock, y le llega el aviso push
--                               al celular (api/push-faltantes.ts).
--
-- Se lo damos a la cuenta puesto3 (puesto3indo@gmail.com), igual que con
-- mayorista.pausas.autorizar. Los administradores siempre lo ven.
--
-- La campana no necesita nada más: mira mayorista_armados en vivo (Realtime)
-- y los que quedaron estado='hecho' con faltantes > 0 aparecen como aviso.
-- ============================================================================

BEGIN;

INSERT INTO public.permisos (clave, modulo, accion, label, orden)
VALUES ('mayorista.faltantes.ver', 'mayorista', 'ver', 'Ver avisos de faltantes de stock', 1261)
ON CONFLICT (clave) DO NOTHING;

-- Se lo damos a la cuenta puesto3 (después se puede dar o sacar desde Usuarios)
INSERT INTO public.usuario_permisos (usuario_id, permiso_clave, efecto)
SELECT u.id, 'mayorista.faltantes.ver', 'grant'
  FROM public.usuarios u
 WHERE lower(u.email) = 'puesto3indo@gmail.com'
ON CONFLICT (usuario_id, permiso_clave) DO UPDATE SET efecto = 'grant';

COMMIT;