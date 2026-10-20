/* =====================================================================
   TASA DE CONVERSIÓN - tickets y total de ventas por local y día
   (config del hub: contador_vista_ventas). Una fila por LOCAL + FECHA.
   - MUNOZ sale de la base local de esta PC (DESKTOP-OA4GU6I, Replicador):
     desde 2026-10-20, porque en el servidor MITO dejó de llegar (último
     comprobante allá: 19/10 19:14) y acá sí está al día.
   - VCPD, NVOCED y 9DEJULIO siguen saliendo del servidor vinculado MITO.
   Solo tickets (DESCFW LIKE 'TICKET%'), no anulados, últimos 180 días.
   Correr:  sqlcmd -S localhost -E -C -i sql/vw_ventas_TICKET.sql
   ===================================================================== */
USE [VISTAS_CONSOLIDADAS];
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

    UNION ALL

    SELECT ''9DEJULIO'' AS LOCAL, CAST(C.FFCH AS date) AS FECHA, C.DESCFW, C.FTOTAL
    FROM DRAGONFISH_9DEJUL2.ZooLogic.COMPROBANTEV AS C
    WHERE C.ANULADO = 0
      AND C.DESCFW LIKE ''TICKET%''
      AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
  ) AS T
  GROUP BY LOCAL, FECHA
') AS Q

UNION ALL

-- MUNOZ: base local de esta PC (DESKTOP-OA4GU6I)
SELECT
  CAST('MUNOZ' AS varchar(20)) COLLATE DATABASE_DEFAULT,
  CAST(CONVERT(varchar(10), CAST(C.FFCH AS date), 23) AS varchar(10)) COLLATE DATABASE_DEFAULT,
  CAST(COUNT_BIG(CASE WHEN C.DESCFW LIKE 'TICKETFACTURA%' THEN 1 END) AS bigint),
  CAST(SUM(C.FTOTAL) AS decimal(15,2))
FROM DRAGONFISH_MUNOZ.ZooLogic.COMPROBANTEV AS C
WHERE C.ANULADO = 0
  AND C.DESCFW LIKE 'TICKET%'
  AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
GROUP BY CAST(C.FFCH AS date);
GO
