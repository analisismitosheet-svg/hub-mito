/* =====================================================================
   STOCK DE POLO 52 por SKU (articulo + color + talle)

   Lo usa la Reposicion de franquicias (sugerida y automatica): lo que
   MITO no llega a cubrir sale de Polo y se carga como transferencia
   POLO52 -> MAYORD, como en el reparto de locales.

   Sale de DWH.dbo.vw_FACT_VENTAS_STOCK (servidor MITO), Tienda =
   DRAGONFISH_POLO52, filas STOCK sin transito: es el mismo numero que
   la columna POLO52 del Reparto manual. Con el filtro por tienda tarda
   ~6 s; la vista entera no se puede leer desde el hub.

   Autorizado por el usuario el 2026-11-19 (vista nueva, solo lectura).

   Correr:  node scripts/sql.mjs --alias -f sql/vw_STOCK_SKU_POLO.sql
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_STOCK_SKU_POLO
AS
SELECT ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO, STOCK_POLO
  FROM OPENQUERY([MITO], '
    SELECT LTRIM(RTRIM(ID_ART))   AS ID_ARTICULO,
           LTRIM(RTRIM(ID_COLOR)) AS COLOR_CODIGO,
           LTRIM(RTRIM(ID_TALLE)) AS TALLE_CODIGO,
           CAST(SUM(CANT) AS int) AS STOCK_POLO
      FROM DWH.dbo.vw_FACT_VENTAS_STOCK
     WHERE Tipo = ''STOCK''
       AND Tienda = ''DRAGONFISH_POLO52''
       AND ISNULL(ENTRANSITO, 0) = 0
     GROUP BY LTRIM(RTRIM(ID_ART)), LTRIM(RTRIM(ID_COLOR)), LTRIM(RTRIM(ID_TALLE))
    HAVING SUM(CANT) > 0');
GO
