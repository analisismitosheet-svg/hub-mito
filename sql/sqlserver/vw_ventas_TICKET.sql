-- ============================================================
-- VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET  (SQL Server de DESKTOP-OA4GU6I)
-- Tickets de venta por local y dia: para cruzar con el contador de camaras
-- (ContadorClientes.tsx / TasaConversion.tsx), via config_app 'contador_vista_ventas'.
--
-- Lee las bases DRAGONFISH_* que el Replicador copia a ESTA PC (desde que estan
-- replicadas localmente salen de aca, que es lo que las mantiene al dia). La unica
-- excepcion es RUTA9D2, que todavia sale del servidor principal con OPENQUERY.
-- Cada base aporta su COMPROBANTEV (cabecera; 1 fila = 1 comprobante, NO se une
-- COMPROBANTEVDET porque infla las filas).
--
-- Mapa de locales (el codigo debe coincidir con el de las camaras y la tabla `locales`):
--   DRAGONFISH_MUNOZ   -> MUNOZ
--   DRAGONFISH_VCPD    -> VCPD
--   DRAGONFISH_NVOCED2 -> NVOCED    (las camaras usan NVOCED, NO NVOCED2)
--   DRAGONFISH_9DEJUL2 -> 9DEJULIO  (la vieja DRAGONFISH_9DEJULIO termino el 2025-08-28)
--   DRAGONFISH_ESPINOD -> ESPINOD
--   DRAGONFISH_RUTA9D2 -> RUTA9D2   (por ahora del servidor principal: ver la nota de abajo)
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
-- RUTA 9 (2026-10-22): entra por el servidor principal con OPENQUERY([MITO]), NO por la
-- base de esta PC: DRAGONFISH_RUTA9D2 ya esta creada aca pero el Replicador no la pudo
-- copiar (quedo en 6 tablas, sin COMPROBANTEV) porque no entra al SQL de la sucursal:
-- "Login failed for user 'admin'" contra 100.123.164.106\ZOOLOGIC (fuente "RUTA 9" en
-- C:\ReplicadorSQL\config.json; se ve en Sistemas > Replicas). Al aplicarlo, esa base del
-- principal traia ventas del mismo dia, asi que la conversion de Ruta 9 sale al dia; de
-- todos modos depende de cada cuanto el principal recibe la sucursal, asi que si se ve
-- atrasada, mirar ahi. Cuando el Replicador copie bien, cambiar ese bloque por la lectura
-- local (igual que los otros).
--
-- Aplicar:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/sqlserver/vw_ventas_TICKET.sql
-- ============================================================
USE VISTAS_CONSOLIDADAS;
GO
CREATE OR ALTER VIEW dbo.vw_ventas_TICKET AS
SELECT
  CAST(T.LOCAL AS varchar(20)) COLLATE DATABASE_DEFAULT                            AS LOCAL,
  CAST(CONVERT(varchar(10), T.FECHA, 23) AS varchar(10)) COLLATE DATABASE_DEFAULT  AS FECHA,  -- 'yyyy-mm-dd'
  CASE WHEN T.FECHA >= DATEADD(day, -7, CONVERT(date, GETDATE())) THEN T.HORA END  AS HORA,   -- 0..23 en últimos 7 días, NULL antes
  CAST(COUNT_BIG(CASE WHEN T.DESCFW LIKE 'TICKETFACTURA%' THEN 1 END) AS bigint)   AS TICKETS,
  CAST(SUM(T.FTOTAL) AS decimal(15,2))                                             AS TOTAL
FROM (
  SELECT 'MUNOZ' AS LOCAL, CAST(C.FFCH AS date) AS FECHA,
         TRY_CAST(LEFT(LTRIM(COALESCE(NULLIF(LTRIM(RTRIM(C.HALTAFW)), ''), C.FHORA)), 2) AS int) AS HORA,
         C.DESCFW COLLATE DATABASE_DEFAULT AS DESCFW, C.FTOTAL
  FROM DRAGONFISH_MUNOZ.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT 'VCPD', CAST(C.FFCH AS date),
         TRY_CAST(LEFT(LTRIM(COALESCE(NULLIF(LTRIM(RTRIM(C.HALTAFW)), ''), C.FHORA)), 2) AS int),
         C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_VCPD.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT 'NVOCED', CAST(C.FFCH AS date),
         TRY_CAST(LEFT(LTRIM(COALESCE(NULLIF(LTRIM(RTRIM(C.HALTAFW)), ''), C.FHORA)), 2) AS int),
         C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_NVOCED2.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT '9DEJULIO', CAST(C.FFCH AS date),
         TRY_CAST(LEFT(LTRIM(COALESCE(NULLIF(LTRIM(RTRIM(C.HALTAFW)), ''), C.FHORA)), 2) AS int),
         C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_9DEJUL2.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  SELECT 'ESPINOD', CAST(C.FFCH AS date),
         TRY_CAST(LEFT(LTRIM(COALESCE(NULLIF(LTRIM(RTRIM(C.HALTAFW)), ''), C.FHORA)), 2) AS int),
         C.DESCFW COLLATE DATABASE_DEFAULT, C.FTOTAL
  FROM DRAGONFISH_ESPINOD.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0 AND C.DESCFW LIKE 'TICKET%' AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

  UNION ALL

  -- Ruta 9: del servidor principal (ver la nota RUTA 9 arriba). El filtro va dentro del
  -- OPENQUERY, asi que por la red vuelven solo sus comprobantes TICKET% (~6 mil filas).
  SELECT 'RUTA9D2', CAST(Q.FECHA AS date),
         TRY_CAST(LEFT(LTRIM(COALESCE(NULLIF(LTRIM(RTRIM(Q.HALTAFW)), ''), Q.FHORA)), 2) AS int),
         Q.DESCFW COLLATE DATABASE_DEFAULT, Q.FTOTAL
  FROM OPENQUERY([MITO], '
    SELECT CAST(C.FFCH AS date) AS FECHA, C.HALTAFW, C.FHORA, C.DESCFW, C.FTOTAL
    FROM DRAGONFISH_RUTA9D2.ZooLogic.COMPROBANTEV AS C
    WHERE C.ANULADO = 0
      AND C.DESCFW LIKE ''TICKET%''
      AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
  ') AS Q
) AS T
GROUP BY T.LOCAL, T.FECHA, CASE WHEN T.FECHA >= DATEADD(day, -7, CONVERT(date, GETDATE())) THEN T.HORA END;
GO
