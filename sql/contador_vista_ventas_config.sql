-- ============================================================
-- Config_app: habilita la vista de ventas del contador de cámaras.
-- Ejecutar en Supabase (proyecto qwlugajzxrrwckrqlrjp).
--
--   contador_vista_ventas -> nombre COMPLETO de la vista, tal como viaja al
--                            puente ("ALIAS:BASE.esquema.objeto"). Lo leen
--                            ContadorClientes.tsx y TasaConversion.tsx.
--   sql_vistas            -> whitelist del proxy /api/sql (se agrega si falta).
--
-- La vista se crea con sql/sqlserver/vw_ventas_TICKET.sql contra la instancia
-- local DESKTOP-OA4GU6I (base VISTAS_CONSOLIDADAS).
-- ============================================================

INSERT INTO public.config_app (clave, valor, updated_at)
VALUES ('contador_vista_ventas', to_jsonb('DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET'::text), now())
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();

UPDATE public.config_app
SET valor = valor || '[{"vista":"DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET","label":"Ventas TICKET (local/día)"}]'::jsonb,
    updated_at = now()
WHERE clave = 'sql_vistas'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(valor) e
    WHERE e->>'vista' = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET'
  );
