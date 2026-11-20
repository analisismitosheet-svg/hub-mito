/* =====================================================================
   CAJAS MAPEADAS (Mapeo depósito) - stock por artículo de DRAGONFISH_INDOD

   Igual que vw_STOCK_ARTICULO_MITO pero sobre la base INDOD: una fila por
   artículo con la suma del stock FÍSICO (COCANT) de todos sus colores y
   talles. La columna se llama STOCK_MITO para que el hub la lea con la
   misma lib (src/lib/stockArticulos.ts) sin tocar nada.

   La lee SOLO Mapeo depósito > Cajas mapeadas (MapeoCajasOrden.tsx).
   Orden mapeado sigue con vw_STOCK_ARTICULO_MITO.

   -------------------------------------------------------------------------
   Correr:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/vw_STOCK_ARTICULO_INDOD.sql
   Verificar:
            node scripts/sql.mjs --alias DESKTOP-OA4GU6I "SELECT COUNT(*) filas, SUM(STOCK_MITO) stock FROM VISTAS_CONSOLIDADAS.dbo.vw_STOCK_ARTICULO_INDOD"
   Habilitarla en el hub: Configuraciones > Conexión SQL (config_app 'sql_vistas').
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_STOCK_ARTICULO_INDOD
AS
SELECT
    LTRIM(RTRIM(C.COART))                     AS ID_ARTICULO,
    CAST(SUM(ISNULL(C.COCANT, 0)) AS INT)     AS STOCK_MITO
FROM MITO.DRAGONFISH_INDOD.ZooLogic.COMB C
WHERE C.BDALTAFW = 'INDOD' AND C.BDMODIFW = 'INDOD'
  AND NULLIF(LTRIM(RTRIM(C.COART)), '') IS NOT NULL
GROUP BY LTRIM(RTRIM(C.COART));
GO
