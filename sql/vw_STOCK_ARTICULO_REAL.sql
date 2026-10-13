/* =====================================================================
   COMPARATIVA DE PRECIOS - stock total por artículo (todas las bases)

   vw_STOCK_SUCURSALES_REAL trae una fila por artículo/color/talle/base
   (BD_ORIGEN), o sea VARIAS filas por artículo. Acá se suma CANTIDAD_REAL
   por ARTICULO para tener el stock TOTAL del artículo sin importar color,
   talle ni base.

   Salida (mismos nombres que ya reconoce src/lib/stockArticulos.ts):
       ID_ARTICULO   código del maestro (el mismo id_art de articulos)
       STOCK_MITO    suma de CANTIDAD_REAL de todas las bases

   La vista NO filtra por base a propósito: es el total de MITO.

   -------------------------------------------------------------------------
   Correr:  node scripts/sql.mjs --alias SQL2 -f sql/vw_STOCK_ARTICULO_REAL.sql
            (SQL2 = la instancia local; sin --alias cae en ZOOLOGIC, que NO
             tiene estas vistas)
   Verificar:
            node scripts/sql.mjs --alias SQL2 "SELECT COUNT(*) filas, SUM(STOCK_MITO) unidades FROM VISTAS_CONSOLIDADAS.dbo.vw_STOCK_ARTICULO_REAL"
   Después: habilitarla en Configuraciones > Conexión SQL
            (DESKTOP-OA4GU6I -> base VISTAS_CONSOLIDADAS -> esquema dbo ->
             vw_STOCK_ARTICULO_REAL)
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_STOCK_ARTICULO_REAL
AS
SELECT
    ARTICULO AS ID_ARTICULO,
    CAST(SUM(CANTIDAD_REAL) AS INT) AS STOCK_MITO
FROM dbo.vw_STOCK_SUCURSALES_REAL
WHERE NULLIF(LTRIM(RTRIM(ARTICULO)), '') IS NOT NULL
GROUP BY ARTICULO;
GO
