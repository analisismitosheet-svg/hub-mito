-- ============================================================
-- VISTAS_CONSOLIDADAS.dbo.venta_franquicias  (SQL Server de DESKTOP-OA4GU6I)
-- Líneas de venta (cabecera + detalle) de las franquicias. Hoy: DRAGONFISH_CFU.
-- La lee Mayorista > Franquicias (MayoristaFranquicias.tsx).
--
-- 2026-10-16: se agrega BASE_DATOS (nombre de la base de donde sale cada fila).
-- El resto de las columnas queda igual que la vista original.
--
-- Aplicar:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/sqlserver/venta_franquicias.sql
-- ============================================================
USE VISTAS_CONSOLIDADAS;
GO
CREATE OR ALTER VIEW [dbo].[venta_franquicias] AS
SELECT 
      CAST('DRAGONFISH_CFU' AS varchar(50)) AS [BASE_DATOS],
      V.[CODIGO],
      V.[DESCFW],
      V.[FCLIENTE],
      V.[FVEN],
      V.[MOTIVO],
      V.[FFCH],
      V.[FHORA],
      V.[FIMPUESTO],
      V.[FLETRA],
      V.[FNUMCOMP],
      V.[FOBS],
      V.[FPERSON],
      V.[FSUBTON],
      V.[FSUBTOT],
      V.[FTOTAL],
      V.[FTURNO],
      V.[FVUELTO],
      V.[GRAVAMEN],
      V.[HALTAFW],
      V.[IDCAJA],
      V.[IVASIS],
      V.[REMITO],
      V.[SIGNOMOV],
      V.[UALTAFW],
      -- Campos del detalle
      D.[AFECANT],
      D.[CCOLOR],
      D.[EQUIV],
      D.[FART],
      D.[FBRUTO],
      D.[FCANT],
      D.[FCFI],
      D.[FCFITOT],
      D.[FCOLTXT],
      D.[FMTOIVA],
      D.[FNETO],
      D.[FPORIVA],
      D.[FPRECIO],
      D.[FPRUN],
      D.[FTATXT],
      D.[FTXT],
      D.[MNDESCI],
      D.[MNTPIVA],
      D.[MNTPTOT],
      D.[PRUNCONIMP],
      D.[TALLE]
FROM [DRAGONFISH_CFU].[ZooLogic].[COMPROBANTEV] AS V
INNER JOIN [DRAGONFISH_CFU].[ZooLogic].[COMPROBANTEVDET] AS D
      ON V.[CODIGO] = D.[CODIGO];
GO
