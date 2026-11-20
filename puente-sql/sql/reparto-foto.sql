/*
 * REPARTO MANUAL — FOTO GENERAL (todos los artículos). SOLO LECTURA.
 *
 * vw_FACT_VENTAS_STOCK se recorre entera con cualquier filtro (~80 s), así que en vez de leerla
 * en cada armado se lee UNA vez para todos los artículos y reparto.js arma cada reparto desde
 * esta foto en memoria (en segundos). Se renueva cada 15 min mientras alguien usa el reparto.
 * Medido el 20/11/2026: ~190 mil renglones de stock, ~100 mil de venta diaria (60 días),
 * ~130 mil de última venta.
 *
 * Parámetros (varchar 'YYYY-MM-DD'):
 *   @desde_ult    desde cuándo se busca la última venta (~180 días)
 *   @desde_venta  primer día de venta que se guarda día por día (~62 días)
 *
 * Resultados:
 *   1) stock por tienda y SKU (CANT) + cantidad en tránsito (ENTRANSITO)
 *   2) venta neta por día, tienda y SKU desde @desde_venta (devoluciones restan; solo <> 0)
 *   3) última venta (> 0) por tienda y SKU desde @desde_ult
 *   4) stock MITO REAL por SKU = físico − comprometido (COMB de DRAGONFISH_MITO), solo > 0
 *   5) maestro de los artículos con stock, venta o stock MITO (atributos para filtrar, como reparto-stock.sql)
 */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#f') IS NOT NULL DROP TABLE #f;
SELECT LEFT(Fecha, 10)                AS dia,
       Tipo,
       Tienda,
       LTRIM(RTRIM(ID_ART))           AS ID_ART,
       LTRIM(RTRIM(ID_COLOR))         AS ID_COLOR,
       LTRIM(RTRIM(ID_TALLE))         AS ID_TALLE,
       CAST(CANT AS int)              AS CANT,
       CAST(ISNULL(ENTRANSITO, 0) AS int) AS ENTRANSITO
  INTO #f
  FROM DWH.dbo.vw_FACT_VENTAS_STOCK
 WHERE Tipo IN ('VENTA', 'STOCK')
   AND Fecha >= @desde_ult;

-- 1) stock actual y tránsito
SELECT Tienda, ID_ART, ID_COLOR, ID_TALLE,
       -- CANT = stock del local; ENTRANSITO = CANTIDAD que le viene en camino (no es 0/1).
       -- Hasta el 20/11 se sumaba solo CANT de los renglones sin tránsito: un talle con algo en
       -- camino quedaba con stock 0 (ej. CF165211 02 L en Polo 52: 149 en el local, el reparto daba 0)
       SUM(CANT)                                              AS stock,
       SUM(CASE WHEN ENTRANSITO > 0 THEN ENTRANSITO ELSE 0 END) AS transito
  FROM #f
 WHERE Tipo = 'STOCK'
 GROUP BY Tienda, ID_ART, ID_COLOR, ID_TALLE
HAVING SUM(CANT) <> 0 OR SUM(CASE WHEN ENTRANSITO > 0 THEN ENTRANSITO ELSE 0 END) > 0;

-- 2) venta neta por día
SELECT dia, Tienda, ID_ART, ID_COLOR, ID_TALLE, SUM(CANT) AS venta
  FROM #f
 WHERE Tipo = 'VENTA' AND dia >= @desde_venta
 GROUP BY dia, Tienda, ID_ART, ID_COLOR, ID_TALLE
HAVING SUM(CANT) <> 0;

-- 3) última venta
SELECT Tienda, ID_ART, ID_COLOR, ID_TALLE, MAX(dia) AS ultima
  FROM #f
 WHERE Tipo = 'VENTA' AND CANT > 0
 GROUP BY Tienda, ID_ART, ID_COLOR, ID_TALLE;

-- artículos con algo en la foto (los del maestro sin stock ni venta no aparecen en ningún reparto)
IF OBJECT_ID('tempdb..#ids') IS NOT NULL DROP TABLE #ids;
CREATE TABLE #ids (ID_ART varchar(60) COLLATE DATABASE_DEFAULT PRIMARY KEY);
INSERT #ids (ID_ART) SELECT DISTINCT ID_ART FROM #f WHERE ID_ART <> '';

DROP TABLE #f;

-- 4) stock MITO real = físico − comprometido (cada parte del comprometido con piso 0)
SELECT ID_ART, ID_COLOR, ID_TALLE, stock
  FROM (SELECT LTRIM(RTRIM(COART)) AS ID_ART, LTRIM(RTRIM(COCOL)) AS ID_COLOR, LTRIM(RTRIM(TALLE)) AS ID_TALLE,
               SUM(CAST(ISNULL(COCANT, 0) AS int))
             - SUM(CASE WHEN ISNULL(PEDIDO, 0) > 0 THEN CAST(PEDIDO AS int) ELSE 0 END
                 + CASE WHEN ISNULL(PREPARADO, 0) > 0 THEN CAST(PREPARADO AS int) ELSE 0 END) AS stock
          FROM DRAGONFISH_MITO.ZooLogic.COMB
         WHERE BDALTAFW = 'MITO' AND BDMODIFW = 'MITO'
         GROUP BY LTRIM(RTRIM(COART)), LTRIM(RTRIM(COCOL)), LTRIM(RTRIM(TALLE))) x
 WHERE stock > 0;

INSERT #ids (ID_ART)
SELECT DISTINCT LTRIM(RTRIM(COART)) FROM DRAGONFISH_MITO.ZooLogic.COMB c
 WHERE BDALTAFW = 'MITO' AND BDMODIFW = 'MITO' AND LTRIM(RTRIM(COART)) <> ''
   AND NOT EXISTS (SELECT 1 FROM #ids i WHERE i.ID_ART = LTRIM(RTRIM(c.COART)));

-- Maestro y género: primero a tablas temporales (la vista sola tarda ~2 s; cruzarla directo con
-- #ids tardaba ~4 min) y recién ahí se cruzan
IF OBJECT_ID('tempdb..#m') IS NOT NULL DROP TABLE #m;
SELECT LTRIM(RTRIM(a.ID_ART))             AS ID_ART,
       LTRIM(RTRIM(a.ARTICULO_ADICIONAL)) AS ARTICULO_ADICIONAL,
       LTRIM(RTRIM(a.ARTICULO))           AS ARTICULO,
       LTRIM(RTRIM(a.ID_PROV))            AS ID_PROV,
       UPPER(LTRIM(RTRIM(a.ID_GRUPO)))    AS ID_GRUPO,
       LTRIM(RTRIM(a.ID_FLIA))            AS ID_FLIA,
       LTRIM(RTRIM(a.ID_LINEA))           AS ID_LINEA,
       LTRIM(RTRIM(a.ID_MATERIAL))        AS ID_MATERIAL,
       LTRIM(RTRIM(a.ID_TEMPORADA))       AS ID_TEMPORADA,
       CAST(CAST(a.[AÑO] AS int) AS varchar(10)) AS ANIO
  INTO #m
  FROM DWH.dbo.vw_DIM_ARTICULO a
 WHERE CHARINDEX(' ', RTRIM(a.ID_ART)) = 0;

-- género = categoría del artículo en Dragon
IF OBJECT_ID('tempdb..#g') IS NOT NULL DROP TABLE #g;
SELECT LTRIM(RTRIM(z.ARTCOD)) AS ID_ART, MAX(LTRIM(RTRIM(z.CATEARTI))) AS GEN
  INTO #g
  FROM DRAGONFISH_MITO.ZooLogic.ART z
 GROUP BY LTRIM(RTRIM(z.ARTCOD));

-- 5) maestro de los artículos con algo (mismos criterios que el filtro de reparto-stock.sql)
SELECT m.*, g.GEN
  FROM #m m
  JOIN #ids i ON i.ID_ART = m.ID_ART COLLATE DATABASE_DEFAULT
  LEFT JOIN #g g ON g.ID_ART COLLATE DATABASE_DEFAULT = m.ID_ART COLLATE DATABASE_DEFAULT;

DROP TABLE #m;
DROP TABLE #g;
DROP TABLE #ids;
