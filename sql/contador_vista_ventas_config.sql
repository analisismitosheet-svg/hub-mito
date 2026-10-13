-- ============================================================
-- Config_app: habilita la vista de ventas del contador de cámaras.
-- Ejecutar en Supabase (proyecto qwlugajzxrrwckrqlrjp).
--
--   contador_vista_ventas -> nombre COMPLETO de la vista, tal como viaja al
--                            puente ("BASE.esquema.objeto" o "ALIAS:BASE.esquema.objeto").
--                            Lo leen ContadorClientes.tsx y TasaConversion.tsx.
--   sql_vistas            -> whitelist del proxy /api/sql (se limpian las entradas
--                            viejas y se agrega la de VISTAS_CONSOLIDADAS).
--
-- La vista se crea con sql/sqlserver/vw_ventas_TICKET.sql (USE VISTAS_CONSOLIDADAS,
-- se aplica con --alias DESKTOP-OA4GU6I). Corre en la instancia local, en la base
-- VISTAS_CONSOLIDADAS, y el trabajo pesado lo hace el servidor de MITO (OPENQUERY).
-- ============================================================

INSERT INTO public.config_app (clave, valor, updated_at)
VALUES ('contador_vista_ventas', to_jsonb('DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET'::text), now())
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();

-- Quita las entradas viejas de la vista de ventas (quedó primero en la instancia
-- local y después en DWH; ahora vuelve a VISTAS_CONSOLIDADAS, optimizada).
UPDATE public.config_app
SET valor = COALESCE((
      SELECT jsonb_agg(e ORDER BY ord)
      FROM jsonb_array_elements(valor) WITH ORDINALITY AS t(e, ord)
      WHERE e->>'vista' NOT IN (
        'DWH.dbo.vw_ventas_TICKET',
        'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET'
      )
    ), '[]'::jsonb),
    updated_at = now()
WHERE clave = 'sql_vistas';

-- Agrega la vista de VISTAS_CONSOLIDADAS si falta.
UPDATE public.config_app
SET valor = valor || '[{"vista":"DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET","label":"Ventas TICKET (local/día)"}]'::jsonb,
    updated_at = now()
WHERE clave = 'sql_vistas'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(valor) e
    WHERE e->>'vista' = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET'
  );
