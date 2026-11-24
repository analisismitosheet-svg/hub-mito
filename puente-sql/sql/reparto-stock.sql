/*
 * REPARTO MANUAL (Reposiciones / Transferencias > Reparto manual) — stock y venta de cada local
 * y depósito para los artículos filtrados en el paso 1. SOLO LECTURA.
 *
 * Parámetros (varchar; listas separadas por '|', vacío = sin filtro):
 *   @prov @mat @temp @anio @linea @flia @grupo @gen   atributos del artículo (como el tablero de PBI)
 *   marca ORIGEN  reparto.js la cambia por la condición de MITO (proveedor MO…) o MARCAS (el resto)
 *   @art     códigos o principios de código separados por '|' (opcional)
 *   @x       'CON' = solo líneas que contienen X (X, XG, W50OFF-XG…) · 'SIN' = línea sin X · '' = todos
 *   @desde @hasta  período de venta 'YYYY-MM-DD'
 *   @desde_ult     desde cuándo se busca la última venta (días sin venta, ~180 días)
 *   @max           tope de artículos (si se pasa, devuelve solo el recordset 1 con la cantidad)
 *
 * vw_FACT_VENTAS_STOCK guarda Fecha como texto y junta ~18 bases: cualquier filtro la recorre
 * entera (~50-120 s). Se lee UNA vez a #f y de ahí salen los resultados.
 *
 * Resultados:
 *   1) cantidad de artículos que entran en el filtro
 *   2) stock por tienda y SKU (CANT) + cantidad en tránsito (ENTRANSITO es la cantidad en camino)
 *   3) venta neta por tienda y SKU en [@desde, @hasta] (devoluciones restan)
 *   4) última venta (> 0) por tienda y SKU desde @desde_ult
 *   5) stock MITO REAL por SKU = físico − comprometido (COMB de DRAGONFISH_MITO, como la Repo diaria)
 *   6) maestro de los artículos (descripción macro, atributos)
 */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#a') IS NOT NULL DROP TABLE #a;
CREATE TABLE #a (ID_ART varchar(30) COLLATE DATABASE_DEFAULT PRIMARY KEY);

INSERT #a (ID_ART)
SELECT DISTINCT LTRIM(RTRIM(a.ID_ART))
  FROM DWH.dbo.vw_DIM_ARTICULO a
 WHERE CHARINDEX(' ', RTRIM(a.ID_ART)) = 0
   AND (@prov  = '' OR LTRIM(RTRIM(a.ID_PROV))      IN (SELECT value FROM STRING_SPLIT(@prov, '|')))
   -- origen (MITO = proveedor MO…, MARCAS = el resto): reparto.js reemplaza la marca de abajo
   /*ORIGEN*/
   AND (@mat   = '' OR LTRIM(RTRIM(a.ID_MATERIAL))  IN (SELECT value FROM STRING_SPLIT(@mat, '|')))
   AND (@temp  = '' OR LTRIM(RTRIM(a.ID_TEMPORADA)) IN (SELECT value FROM STRING_SPLIT(@temp, '|')))
   AND (@anio  = '' OR CAST(CAST(a.[AÑO] AS int) AS varchar(10)) IN (SELECT value FROM STRING_SPLIT(@anio, '|')))
   AND (@linea = '' OR LTRIM(RTRIM(a.ID_LINEA))     IN (SELECT value FROM STRING_SPLIT(@linea, '|')))
   AND (@flia  = '' OR LTRIM(RTRIM(a.ID_FLIA))      IN (SELECT value FROM STRING_SPLIT(@flia, '|')))
   AND (@grupo = '' OR UPPER(LTRIM(RTRIM(a.ID_GRUPO))) IN (SELECT value FROM STRING_SPLIT(@grupo, '|')))
   AND (@art   = '' OR EXISTS (SELECT 1 FROM STRING_SPLIT(@art, '|') x WHERE LTRIM(RTRIM(a.ID_ART)) LIKE x.value + '%'))
   -- línea con X o sin X (@x = 'CON' | 'SIN' | '')
   AND (@x = '' OR (@x = 'CON' AND UPPER(ISNULL(a.ID_LINEA, '')) LIKE '%X%') OR (@x = 'SIN' AND UPPER(ISNULL(a.ID_LINEA, '')) NOT LIKE '%X%'))
   AND (@gen   = '' OR EXISTS (SELECT 1 FROM DRAGONFISH_MITO.ZooLogic.ART z
                                WHERE RTRIM(z.ARTCOD) = RTRIM(a.ID_ART)
                                  AND LTRIM(RTRIM(z.CATEARTI)) IN (SELECT value FROM STRING_SPLIT(@gen, '|'))));

-- 1) cuántos artículos entran
SELECT COUNT(*) AS articulos FROM #a;
IF (SELECT COUNT(*) FROM #a) = 0 OR (SELECT COUNT(*) FROM #a) > CAST(@max AS int) RETURN;

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
   AND Fecha >= @desde_ult
   AND LTRIM(RTRIM(ID_ART)) IN (SELECT ID_ART FROM #a);

-- 2) stock actual y tránsito
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

-- 3) venta neta del período
SELECT Tienda, ID_ART, ID_COLOR, ID_TALLE, SUM(CANT) AS venta
  FROM #f
 WHERE Tipo = 'VENTA' AND dia >= @desde AND dia <= @hasta
 GROUP BY Tienda, ID_ART, ID_COLOR, ID_TALLE
HAVING SUM(CANT) > 0;

-- 4) última venta
SELECT Tienda, ID_ART, ID_COLOR, ID_TALLE, MAX(dia) AS ultima
  FROM #f
 WHERE Tipo = 'VENTA' AND CANT > 0
 GROUP BY Tienda, ID_ART, ID_COLOR, ID_TALLE;

-- 5) stock MITO real = físico − comprometido (cada parte del comprometido con piso 0)
SELECT LTRIM(RTRIM(COART)) AS ID_ART, LTRIM(RTRIM(COCOL)) AS ID_COLOR, LTRIM(RTRIM(TALLE)) AS ID_TALLE,
       SUM(CAST(ISNULL(COCANT, 0) AS int))
     - SUM(CASE WHEN ISNULL(PEDIDO, 0) > 0 THEN CAST(PEDIDO AS int) ELSE 0 END
         + CASE WHEN ISNULL(PREPARADO, 0) > 0 THEN CAST(PREPARADO AS int) ELSE 0 END) AS stock
  FROM DRAGONFISH_MITO.ZooLogic.COMB
 WHERE BDALTAFW = 'MITO' AND BDMODIFW = 'MITO'
   AND LTRIM(RTRIM(COART)) IN (SELECT ID_ART FROM #a)
 GROUP BY LTRIM(RTRIM(COART)), LTRIM(RTRIM(COCOL)), LTRIM(RTRIM(TALLE));

-- 6) maestro
SELECT LTRIM(RTRIM(a.ID_ART))             AS ID_ART,
       LTRIM(RTRIM(a.ARTICULO_ADICIONAL)) AS ARTICULO_ADICIONAL,
       LTRIM(RTRIM(a.ARTICULO))           AS ARTICULO,
       LTRIM(RTRIM(a.ID_PROV))            AS ID_PROV,
       UPPER(LTRIM(RTRIM(a.ID_GRUPO)))    AS ID_GRUPO,
       LTRIM(RTRIM(a.ID_FLIA))            AS ID_FLIA,
       LTRIM(RTRIM(a.ID_LINEA))           AS ID_LINEA,
       LTRIM(RTRIM(a.ID_MATERIAL))        AS ID_MATERIAL,
       LTRIM(RTRIM(a.ID_TEMPORADA))       AS ID_TEMPORADA
  FROM DWH.dbo.vw_DIM_ARTICULO a
 WHERE LTRIM(RTRIM(a.ID_ART)) IN (SELECT ID_ART FROM #a);

DROP TABLE #f;
DROP TABLE #a;
