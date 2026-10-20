/* =====================================================================
   TASA DE CONVERSIÓN - tickets y total de ventas por local y día
   (config del hub: contador_vista_ventas). Una fila por LOCAL + FECHA.
   Desde 2026-10-20 TODO sale de las bases locales de esta PC
   (DESKTOP-OA4GU6I, las que mantiene el Replicador), ya no del servidor
   vinculado MITO (ahí Muñoz dejó de llegar el 19/10).
   Solo tickets (DESCFW LIKE 'TICKET%'), no anulados, últimos 180 días.
   Correr:  sqlcmd -S localhost -E -C -i sql/vw_ventas_TICKET.sql
   ===================================================================== */
USE [VISTAS_CONSOLIDADAS];
GO
CREATE OR ALTER VIEW dbo.vw_ventas_TICKET AS
SELECT
  CAST(T.LOCAL AS varchar(20)) COLLATE DATABASE_DEFAULT                                   AS LOCAL,
  CAST(CONVERT(varchar(10), T.FECHA, 23) AS varchar(10)) COLLATE DATABASE_DEFAULT        AS FECHA,  -- 'yyyy-mm-dd'
  CAST(COUNT_BIG(CASE WHEN T.DESCFW LIKE 'TICKETFACTURA%' THEN 1 END) AS bigint)          AS TICKETS,
  CAST(SUM(T.FTOTAL) AS decimal(15,2))                                                    AS TOTAL
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
) AS T
GROUP BY T.LOCAL, T.FECHA;
GO
