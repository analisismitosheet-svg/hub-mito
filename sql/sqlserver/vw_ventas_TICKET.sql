-- ============================================================
-- VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET  (SQL Server de DESKTOP-OA4GU6I)
-- Tickets de venta por local y día: para cruzar con el contador de cámaras
-- (ContadorClientes.tsx / TasaConversion.tsx).
--
-- Bases: DRAGONFISH_MUNOZ, DRAGONFISH_VCPD y DRAGONFISH_NVOCED2, cada una
-- sobre su propia COMPROBANTEV (cabecera; 1 fila = 1 comprobante, NO se une
-- COMPROBANTEVDET porque infla las filas: 1 fila por artículo).
-- Mapa de locales (deben coincidir con cámaras / tabla `locales`):
--   DRAGONFISH_MUNOZ  -> MUNOZ
--   DRAGONFISH_VCPD   -> VCPD
--   DRAGONFISH_NVOCED2-> NVOCED   (las cámaras usan NVOCED, NO NVOCED2)
--
-- Criterio (elegido 2026-10-13):
--   * Se toman los comprobantes DESCFW LIKE 'TICKET%' no anulados.
--   * TICKETS = cantidad de TICKETFACTURA (ventas reales).
--   * TOTAL   = suma de FTOTAL de todos los TICKET% -> las TICKETNOTADECREDITO
--               vienen en negativo, así que el total queda NETO de devoluciones.
--   * Ventana de 180 días: la vista se lee completa desde el navegador (tope de
--     5000 filas de /api/sql) y el tablero solo compara hasta ~30 días atrás.
--
-- Igual que el resto de las consolidadas, el filtro, la unión y la agrupación
-- corren en el servidor de MITO (OPENQUERY): por la red vuelven solo las ~500
-- filas ya agrupadas. Si se hiciera desde acá (4 partes), esta PC bajaría las
-- COMPROBANTEV enteras y tardaría de más.
--
-- Aplicar:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/sqlserver/vw_ventas_TICKET.sql
-- ============================================================
USE VISTAS_CONSOLIDADAS;
GO
CREATE OR ALTER VIEW dbo.vw_ventas_TICKET AS
SELECT
  CAST(Q.LOCAL   AS varchar(20))   COLLATE DATABASE_DEFAULT AS LOCAL,
  CAST(Q.FECHA   AS varchar(10))   COLLATE DATABASE_DEFAULT AS FECHA,  -- 'yyyy-mm-dd'
  CAST(Q.TICKETS AS bigint)                                  AS TICKETS,
  CAST(Q.TOTAL   AS decimal(15,2))                           AS TOTAL
FROM OPENQUERY([MITO], '
  SELECT LOCAL,
         CONVERT(varchar(10), FECHA, 23) AS FECHA,
         COUNT_BIG(CASE WHEN DESCFW LIKE ''TICKETFACTURA%'' THEN 1 END) AS TICKETS,
         CAST(SUM(FTOTAL) AS decimal(15,2)) AS TOTAL
  FROM (
    SELECT ''MUNOZ'' AS LOCAL, CAST(C.FFCH AS date) AS FECHA, C.DESCFW, C.FTOTAL
    FROM DRAGONFISH_MUNOZ.ZooLogic.COMPROBANTEV AS C
    WHERE C.ANULADO = 0
      AND C.DESCFW LIKE ''TICKET%''
      AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

    UNION ALL

    SELECT ''VCPD'' AS LOCAL, CAST(C.FFCH AS date) AS FECHA, C.DESCFW, C.FTOTAL
    FROM DRAGONFISH_VCPD.ZooLogic.COMPROBANTEV AS C
    WHERE C.ANULADO = 0
      AND C.DESCFW LIKE ''TICKET%''
      AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))

    UNION ALL

    SELECT ''NVOCED'' AS LOCAL, CAST(C.FFCH AS date) AS FECHA, C.DESCFW, C.FTOTAL
    FROM DRAGONFISH_NVOCED2.ZooLogic.COMPROBANTEV AS C
    WHERE C.ANULADO = 0
      AND C.DESCFW LIKE ''TICKET%''
      AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
  ) AS T
  GROUP BY LOCAL, FECHA
') AS Q;
GO
