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
 *   1) stock por tienda y SKU (STOCK sin tránsito) + marca de tránsito
 *   2) venta neta por día, tienda y SKU desde @desde_venta (devoluciones restan; solo <> 0)
 *   3) última venta (> 0) por tienda y SKU desde @desde_ult
 *   4) stock MITO REAL por SKU = físico − comprometido (COMB de DRAGONFISH_MITO), solo > 0
 *   5) maestro de TODOS los artículos (atributos para filtrar, como reparto-stock.sql)
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
       SUM(CASE WHEN ENTRANSITO = 0 THEN CANT ELSE 0 END) AS stock,
       MAX(CASE WHEN ENTRANSITO >= 1 THEN 1 ELSE 0 END)   AS transito
  FROM #f
 WHERE Tipo = 'STOCK'
 GROUP BY Tienda, ID_ART, ID_COLOR, ID_TALLE
HAVING SUM(CASE WHEN ENTRANSITO = 0 THEN CANT ELSE 0 END) <> 0 OR MAX(ENTRANSITO) >= 1;

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

-- 5) maestro (mismos criterios que el filtro de reparto-stock.sql; género = categoría en Dragon)
SELECT LTRIM(RTRIM(a.ID_ART))             AS ID_ART,
       LTRIM(RTRIM(a.ARTICULO_ADICIONAL)) AS ARTICULO_ADICIONAL,
       LTRIM(RTRIM(a.ARTICULO))           AS ARTICULO,
       LTRIM(RTRIM(a.ID_PROV))            AS ID_PROV,
       UPPER(LTRIM(RTRIM(a.ID_GRUPO)))    AS ID_GRUPO,
       LTRIM(RTRIM(a.ID_FLIA))            AS ID_FLIA,
       LTRIM(RTRIM(a.ID_LINEA))           AS ID_LINEA,
       LTRIM(RTRIM(a.ID_MATERIAL))        AS ID_MATERIAL,
       LTRIM(RTRIM(a.ID_TEMPORADA))       AS ID_TEMPORADA,
       CAST(CAST(a.[AÑO] AS int) AS varchar(10)) AS ANIO,
       (SELECT TOP 1 LTRIM(RTRIM(z.CATEARTI)) FROM DRAGONFISH_MITO.ZooLogic.ART z
         WHERE RTRIM(z.ARTCOD) = RTRIM(a.ID_ART)) AS GEN
  FROM DWH.dbo.vw_DIM_ARTICULO a
 WHERE CHARINDEX(' ', RTRIM(a.ID_ART)) = 0;
