-- ============================================================
-- VISTAS_CONSOLIDADAS.dbo.vw_ventas_TICKET
-- Tickets de venta: cruzar con contador de cámaras (ContadorClientes/TasaConversion).
--
-- Bases: DRAGONFISH_NVOCED2, DRAGONFISH_VCPD, DRAGONFISH_MUNOZ
-- Mapas:
--   DRAGONFISH_NVOCED2 -> NVOCED (las cámaras usan NVOCED, no NVOCED2)
--   DRAGONFISH_VCPD -> VCPD
--   DRAGONFISH_MUNOZ -> MUNOZ
--
-- Reglas:
-- - Solo TICKETFACTURA, no anulados (ANULADO=1). Notas de crédito (TICKETNOTADECREDITO)
--   no incrementan 'tickets', pero su FTOTAL (negativo) se resta de TOTAL.
-- - Agregado por LOCAL, FECHA (CAST(FFCH AS date)). 'tickets' = COUNT(DISTINCT COMPROBANTEV.CODIGO) de TICKETFACTURA válidos.
-- - 'total' = SUM(FTOTAL de TICKETFACTURA válidos) + SUM(FTOTAL de TICKETNOTADECREDITO vinculadas/no vinculadas? Se suma neto por día: lo que aplica es lo facturado neto de devoluciones del día)
--   Pero para simplificar y ser consistente con lo que pide "el total", aquí
--   calculamos: TOTAL_NETO_DIA = SUM(FTOTAL) de todos los comprobantes TICKETFACTURA/TICKETNOTADECREDITO NO anulados, agrupados por LOCAL, FECHA.
--   Alternativa conservadora: total = solo FTOTAL de TICKETFACTURA válidos. Con la respuesta elegida (neto con NC), lo más fiel es sumar FTOTAL de ambos tipos (negativos restan).
--
-- Ventana: últimos 180 días (ajustable cambiando DATEADD).
-- (Aplicado para permitir cruce con la pantalla Tasa de conversión.)
-- ============================================================
USE VISTAS_CONSOLIDADAS;
GO
CREATE OR ALTER VIEW dbo.vw_ventas_TICKET AS
SELECT
  LOCAL,
  CONVERT(char(10), FECHA, 23) AS FECHA,   -- 'yyyy-mm-dd' explícito (evita corrimientos de zona horaria al serializar la fecha)
  COUNT_BIG(CASE WHEN TIPO = 'TICKETFACTURA' THEN CODIGO END) AS TICKETS,
  CAST(SUM(FTOTAL) AS decimal(15,2)) AS TOTAL
FROM (
  -- MUNOZ
  SELECT
    'MUNOZ' AS LOCAL,
    CAST(C.FFCH AS date) AS FECHA,
    LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) AS TIPO,
    C.CODIGO,
    C.FTOTAL
  FROM DRAGONFISH_MUNOZ.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0
    AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
    AND (
      LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) = 'TICKETFACTURA'
      OR LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) = 'TICKETNOTADECREDITO'
    )

  UNION ALL

  -- VCPD
  SELECT
    'VCPD' AS LOCAL,
    CAST(C.FFCH AS date) AS FECHA,
    LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) AS TIPO,
    C.CODIGO,
    C.FTOTAL
  FROM DRAGONFISH_VCPD.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0
    AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
    AND (
      LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) = 'TICKETFACTURA'
      OR LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) = 'TICKETNOTADECREDITO'
    )

  UNION ALL

  -- NVOCED2 -> NVOCED
  SELECT
    'NVOCED' AS LOCAL,
    CAST(C.FFCH AS date) AS FECHA,
    LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) AS TIPO,
    C.CODIGO,
    C.FTOTAL
  FROM DRAGONFISH_NVOCED2.ZooLogic.COMPROBANTEV AS C
  WHERE C.ANULADO = 0
    AND C.FFCH >= DATEADD(day, -180, CONVERT(date, GETDATE()))
    AND (
      LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) = 'TICKETFACTURA'
      OR LEFT(LTRIM(RTRIM(C.DESCFW)), CHARINDEX(' ', LTRIM(RTRIM(C.DESCFW)) + ' ') - 1) = 'TICKETNOTADECREDITO'
    )
) AS T
GROUP BY LOCAL, FECHA;
GO