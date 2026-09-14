-- ============================================================================
-- VISTA DE SALIDAS PARA AUTO-MARCADO EN LA PWA
-- ============================================================================
-- Crea una vista en TU SQL Server local que reporta qué artículos YA salieron /
-- se remitieron de cada local. La PWA (Reposiciones/Transferencias) la consulta
-- en bucle y marca automáticamente como "hecho" los artículos del Excel que
-- coinciden, para que el usuario no tenga que tildarlos uno por uno.
--
-- COLUMNAS ESPERADAS POR LA PWA (case-insensitive):
--   origen   | local   -> código del local origen (ej. WALMART, RUTA9D, INDOD)
--   articulo           -> código del artículo (debe coincidir con el del Excel)
--   color              -> color (opcional; '' si no aplica)
--   talle              -> talle (opcional; '' si no aplica)
--
-- El cruce es por: local + articulo + color + talle.
--
-- CONFIGURACIÓN EN LA PWA:
--   Una vez creada y habilitada la vista, indicá su nombre en
--   Configuraciones > Conexión SQL (clave 'sql_vista_salidas') o en la variable
--   de entorno VITE_SQL_VISTA_SALIDAS. Además debe estar en la lista de vistas
--   habilitadas (whitelist) para que el proxy /api/sql/<vista> la permita.
-- ============================================================================

-- ADAPTÁ ESTA CONSULTA A TU ESQUEMA. Este es SOLO un ejemplo de plantilla:
-- supone una tabla de movimientos de salida con los campos que la PWA necesita.
/*
CREATE OR ALTER VIEW dbo.vw_salidas AS
SELECT
    m.ORIGEN        AS origen,     -- código de local origen
    m.ARTICULO      AS articulo,   -- código de artículo
    m.COLOR         AS color,      -- color (o NULL si no aplica)
    m.TALLE         AS talle       -- talle (o NULL si no aplica)
FROM dbo.movimientos m
WHERE m.TIPO = 'SALIDA'            -- solo salidas/remisiones
  AND m.FECHA >= DATEADD(day, -30, GETDATE());  -- ventana reciente (ajustá)
*/
