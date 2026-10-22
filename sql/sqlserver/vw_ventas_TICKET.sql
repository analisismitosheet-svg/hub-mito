-- ============================================================
-- VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET  (SQL Server de DESKTOP-OA4GU6I)
-- Tickets de venta por local y dia: para cruzar con el contador de camaras
-- (ContadorClientes.tsx / TasaConversion.tsx), via config_app 'contador_vista_ventas'.
--
-- Lee las bases DRAGONFISH_* que el Replicador copia a ESTA PC (ya no por OPENQUERY
-- al servidor de MITO: desde que estan replicadas localmente salen de aca, que es lo
-- que las mantiene al dia). Cada base aporta su COMPROBANTEV (cabecera; 1 fila = 1
-- comprobante, NO se une COMPROBANTEVDET porque infla las filas).
--
-- Mapa de locales (el codigo debe coincidir con el de las camaras y la tabla `locales`):
--   DRAGONFISH_MUNOZ   -> MUNOZ
--   DRAGONFISH_VCPD    -> VCPD
--   DRAGONFISH_NVOCED2 -> NVOCED    (las camaras usan NVOCED, NO NVOCED2)
--   DRAGONFISH_9DEJUL2 -> 9DEJULIO  (la vieja DRAGONFISH_9DEJULIO termino el 2025-08-28)
--   DRAGONFISH_ESPINOD -> ESPINOD
--   DRAGONFISH_RUTA9D2 -> RUTA9D2   (ver la nota de abajo: falta que replique)
-- DRAGONFISH_CFU es una FRANQUICIA (CF Ushuaia): no va nunca en ventas/conversion.
--
-- Criterio (elegido 2026-10-13):
--   * Comprobantes DESCFW LIKE 'TICKET%' no anulados.
--   * TICKETS = cantidad de TICKETFACTURA (ventas reales).
--   * TOTAL   = suma de FTOTAL de todos los TICKET% -> las TICKETNOTADECREDITO vienen
--               en negativo, asi que el total queda NETO de devoluciones.
--   * Ventana de 180 dias: la vista se lee completa desde el navegador (tope de 5000
--     filas de /api/sql) y el tablero solo compara hasta ~30 dias atras.
--
-- PENDIENTE RUTA 9 (2026-10-22): la base DRAGONFISH_RUTA9D2 ya esta creada en esta PC
-- pero el Replicador no la pudo copiar (quedo en 6 tablas, sin COMPROBANTEV) porque no
-- entra al SQL de la sucursal: "Login failed for user 'admin'" contra
-- 100.123.164.106\ZOOLOGIC (ver C:\ReplicadorSQL\config.json, fuente "RUTA 9", y
-- Sistemas > Replicas en el hub). En cuanto replique bien, descomentar el bloque de
-- RUTA9D2 de abajo y volver a aplicar esta vista: Ruta 9 deja de mostrar 0% de
-- conversion (hoy cuenta visitas pero no tiene ventas).
--
-- Aplicar:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/sqlserver/vw_ventas_TICKET.sql
-- ============================================================
USE VISTAS_CONSOLIDADAS;
GO
CREATE OR ALTER VIEW dbo.vw_ventas_TICKET AS
SELECT
  CAST(T.LOCAL AS varchar(20)) COLLATE DATABASE_DEFAULT                            AS LOCAL,
  CAST(CONVERT(varchar(10), T.FECHA, 23) AS varchar(10)) COLLATE DATABASE_DEFAULT  AS FECHA,  -- 'yyyy-mm-dd'
  CAST(COUNT_BIG(CASE WHEN T.DESCFW LIKE 'TICKETFACTURA%' THEN 1 END) AS bigint)   AS TICKETS,
  CAST(SUM(T.FTOTAL) AS decimal(15,2))                                             AS TOTAL
FROM (
  SELECT 'MUNOZ' AS LOCAL, CAST(C.FFCH AS date) AS FECHA, C.DESCFW COLLATE DATABASE_DEFAULT AS DESCFW, C.FTOTAL
  FROM DRAGONFISH_MUNOZ.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT 'VCPD', CAST(C.FFCH AS date), C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_VCPD.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT 'NVOCED', CAST(C.FFCH AS date), C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_NVOCED2.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT '9DEJULIO', CAST(C.FFCH AS date), C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_9DEJUL2.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT 'ESPINOD', CAST(C.FFCH AS date), C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_ESPINOD.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  -- Descomentar cuando DRAGONFISH_RUTA9D2 tenga ZooLogic.COMPROBANTEV (ver PENDIENTE RUTA 9 arriba)
  -- UNION ALL
  --
  -- SELECT 'RUTA9D2', CAST(C.FFCH AS date), C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  -- FROM DRAGONFISH_RUTA9D2.ZooLogic.COMPROBANTEV AS C
  -- WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
) AS T
GROUP BY T.LOCAL, T.FECHA;
GO
