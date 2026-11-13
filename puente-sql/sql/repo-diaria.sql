/*
 * REPO DIARIA (Compras > Repo diaria del hub) — lo que antes salía de TRANSFER.pbix.
 *
 * Lee DWH.dbo.vw_FACT_VENTAS_STOCK (la misma vista que usa el PBIX, en vivo) y
 * vw_DIM_ARTICULO. La vista guarda Fecha como texto y junta ~18 bases (algunas
 * por OPENQUERY), así que cualquier filtro la recorre entera: ~50 s. Por eso se
 * lee UNA sola vez a una tabla temporal y de ahí salen los cuatro resultados.
 * El reparto (prioridad de locales, tope = stock MITO) lo hace puente-sql/repo-diaria.js.
 *
 * Parámetro: @desde (varchar 'YYYY-MM-DD'): primer día de venta que se trae (~12 días).
 *
 * Resultados:
 *   1) días       : dia, unidades  (toda la venta, para elegir el último día con venta)
 *   2) ventas     : dia, Tienda, ID_ART, ID_COLOR, ID_TALLE, cant   (solo renglones CANT > 0)
 *   3) stock MITO : ID_ART, ID_COLOR, ID_TALLE, fisico, comprometido, cant (= real, > 0)
 *   4) artículos  : maestro de los artículos que aparecen en 2) y 3)
 */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#f') IS NOT NULL DROP TABLE #f;

SELECT LEFT(Fecha, 10)                AS dia,
       Tipo,
       -- Igual que el Power Query del PBIX: NVOCED2 se llama NVOCED
       REPLACE(Tienda, 'DRAGONFISH_NVOCED2', 'DRAGONFISH_NVOCED') AS Tienda,
       LTRIM(RTRIM(ID_ART))           AS ID_ART,
       LTRIM(RTRIM(ID_COLOR))         AS ID_COLOR,
       LTRIM(RTRIM(ID_TALLE))         AS ID_TALLE,
       CAST(CANT AS int)              AS CANT
  INTO #f
  FROM DWH.dbo.vw_FACT_VENTAS_STOCK
 WHERE Tipo = 'VENTA' AND Fecha >= @desde
   -- El PBIX descarta los artículos con "1P" (Text.Contains distingue mayúsculas)
   AND ID_ART COLLATE Latin1_General_BIN NOT LIKE '%1P%';

/* Stock MITO = STOCK REAL = físico - comprometido (pedido del usuario, 13/11/2026).
   Sale directo de la COMB de MITO (no de la vista, que solo trae el físico):
   comprometido = PEDIDO (pedidos de venta) + PREPARADO, la misma fórmula del
   disponible de Dragon (VISTA_SKU_COMPLETA) y de vw_ARTICULOS_MITO del hub. */
IF OBJECT_ID('tempdb..#s') IS NOT NULL DROP TABLE #s;
SELECT LTRIM(RTRIM(COART)) AS ID_ART, LTRIM(RTRIM(COCOL)) AS ID_COLOR, LTRIM(RTRIM(TALLE)) AS ID_TALLE,
       SUM(CAST(ISNULL(COCANT, 0) AS int))                                   AS fisico,
       -- Hay renglones con PEDIDO negativo (-1) y físico 0: sin el piso en 0 daban
       -- "stock real" 1 de algo que no existe. Cada parte del comprometido, mínimo 0.
       SUM(CASE WHEN ISNULL(PEDIDO, 0) > 0 THEN CAST(PEDIDO AS int) ELSE 0 END
         + CASE WHEN ISNULL(PREPARADO, 0) > 0 THEN CAST(PREPARADO AS int) ELSE 0 END) AS comprometido
  INTO #s
  FROM DRAGONFISH_MITO.ZooLogic.COMB
 WHERE BDALTAFW = 'MITO' AND BDMODIFW = 'MITO'
   AND COART COLLATE Latin1_General_BIN NOT LIKE '%1P%'
 GROUP BY LTRIM(RTRIM(COART)), LTRIM(RTRIM(COCOL)), LTRIM(RTRIM(TALLE));

-- 1) Unidades por día (como day_totals del script: toda la venta, también devoluciones)
SELECT dia, SUM(CANT) AS unidades
  FROM #f
 WHERE Tipo = 'VENTA'
 GROUP BY dia
 ORDER BY dia;

-- 2) Venta por día, tienda y SKU (solo renglones positivos, como el script)
SELECT dia, Tienda, ID_ART, ID_COLOR, ID_TALLE, SUM(CANT) AS cant
  FROM #f
 WHERE Tipo = 'VENTA' AND CANT > 0
 GROUP BY dia, Tienda, ID_ART, ID_COLOR, ID_TALLE;

-- 3) Stock MITO por SKU: real = físico - comprometido (solo los que quedan > 0)
SELECT ID_ART, ID_COLOR, ID_TALLE, fisico, comprometido, fisico - comprometido AS cant
  FROM #s
 WHERE fisico - comprometido > 0;

-- 4) Maestro de los artículos vendidos (DIM_Articulos del PBIX: sin ARTICULO vacío, ID_GRUPO en mayúsculas)
SELECT LTRIM(RTRIM(a.ID_ART))              AS ID_ART,
       LTRIM(RTRIM(a.ARTICULO))            AS ARTICULO,
       LTRIM(RTRIM(a.ARTICULO_ADICIONAL))  AS ARTICULO_ADICIONAL,
       LTRIM(RTRIM(a.ID_PROV))             AS ID_PROV,
       LTRIM(RTRIM(p.PROVEEDOR))           AS PROVEEDOR,
       UPPER(LTRIM(RTRIM(a.ID_GRUPO)))     AS ID_GRUPO,
       LTRIM(RTRIM(a.ID_FLIA))             AS ID_FLIA,
       LTRIM(RTRIM(a.ID_MATERIAL))         AS ID_MATERIAL,
       LTRIM(RTRIM(m.MATERIAL))            AS MATERIAL,
       LTRIM(RTRIM(a.ID_LINEA))            AS ID_LINEA
  FROM (SELECT DISTINCT ID_ART FROM #f) x
  JOIN DWH.dbo.vw_DIM_ARTICULO a ON LTRIM(RTRIM(a.ID_ART)) = x.ID_ART
  LEFT JOIN DWH.dbo.vw_DIM_PROVEEDOR p ON p.ID_PROV = a.ID_PROV
  LEFT JOIN DWH.dbo.vw_DIM_MATERIAL  m ON m.ID_MATERIAL = a.ID_MATERIAL
 WHERE LTRIM(RTRIM(ISNULL(a.ARTICULO, ''))) <> '';

DROP TABLE #f;
DROP TABLE #s;
