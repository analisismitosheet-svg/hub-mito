/* Verificacion de ZooLogic.vw_ARTICULOS_MITO (se corre en DRAGONFISH_MITO).
   node scripts/sql.mjs -f sql/verificar_vw_ARTICULOS_MITO.sql
   Todos los SELECT tienen que dar 0 filas en la columna "mal". */

USE [DRAGONFISH_MITO];
GO

SET NOCOUNT ON;
GO

-- 1) Totales y nulos: sin nombre / sin material / sin color / sin talle
SELECT
    COUNT(*)                                                   AS filas,
    COUNT(DISTINCT ID_ARTICULO)                                 AS articulos,
    SUM(CASE WHEN NOMBRE_COMPLETO IS NULL THEN 1 ELSE 0 END)    AS mal_sin_nombre,
    SUM(CASE WHEN MATERIAL IS NULL THEN 1 ELSE 0 END)           AS mal_sin_material,
    SUM(CASE WHEN GRUPO IS NULL THEN 1 ELSE 0 END)              AS mal_sin_grupo,
    SUM(CASE WHEN COLOR IS NULL THEN 1 ELSE 0 END)              AS mal_sin_color,
    SUM(CASE WHEN TALLE IS NULL THEN 1 ELSE 0 END)              AS mal_sin_talle,
    SUM(CASE WHEN STOCK_MITO < 0 THEN 1 ELSE 0 END)             AS mal_stock_negativo,
    SUM(CASE WHEN SUCURSAL <> 'MITO' THEN 1 ELSE 0 END)         AS mal_sucursal
FROM ZooLogic.vw_ARTICULOS_MITO;
GO

-- 2) La misma fila repetida (no debe haber duplicados de SKU)
SELECT TOP 20 ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO, COUNT(*) AS veces
FROM ZooLogic.vw_ARTICULOS_MITO
GROUP BY ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO
HAVING COUNT(*) > 1;
GO

-- 3) Stock: la vista tiene que coincidir con el COMB de MITO
SELECT TOP 20
    V.ID_ARTICULO, V.COLOR_CODIGO, V.TALLE_CODIGO,
    V.STOCK_MITO,
    ISNULL(C.COCANT,0) - ISNULL(C.PEDIDO,0) - ISNULL(C.PREPARADO,0) AS esperado
FROM ZooLogic.vw_ARTICULOS_MITO V
JOIN ZooLogic.COMB C
  ON C.COART = V.ID_ARTICULO
 AND LTRIM(RTRIM(C.COCOL)) = V.COLOR_CODIGO
 AND COALESCE(NULLIF(LTRIM(RTRIM(C.TALLE)), ''), 'UNICO') = V.TALLE_CODIGO
 AND C.BDALTAFW = 'MITO' AND C.BDMODIFW = 'MITO'
WHERE V.STOCK_MITO <> (CASE WHEN ISNULL(C.COCANT,0)-ISNULL(C.PEDIDO,0)-ISNULL(C.PREPARADO,0) < 0
                            THEN 0
                            ELSE ISNULL(C.COCANT,0)-ISNULL(C.PEDIDO,0)-ISNULL(C.PREPARADO,0) END);
GO

-- 4) Precio: tiene que ser el de LISTA2 (MAYOR) y NO el de otra lista
--    (si sale alguna fila, hay artículos cuyo precio no viene de LISTA2)
SELECT TOP 20
    V.ID_ARTICULO, V.COLOR_CODIGO, V.PRECIO, V.LISTAPRE_MAYOR
FROM ZooLogic.vw_ARTICULOS_MITO V
WHERE V.PRECIO IS NOT NULL
  AND V.LISTAPRE_MAYOR IS DISTINCT FROM 'LISTA2';
GO

-- 5) Cobertura del precio mayorista
SELECT
    COUNT(*)                                          AS filas,
    SUM(CASE WHEN PRECIO IS NULL THEN 1 ELSE 0 END)   AS sin_precio,
    SUM(CASE WHEN PRECIO = 0 THEN 1 ELSE 0 END)      AS precio_en_cero
FROM ZooLogic.vw_ARTICULOS_MITO;
GO

-- 6) Muestra de control (los que mas stock tienen)
SELECT TOP 10
    ID_ARTICULO, COLOR, TALLE, GRUPO, MATERIAL, STOCK_MITO, PRECIO, PRECIO_CONTADO
FROM ZooLogic.vw_ARTICULOS_MITO
ORDER BY STOCK_MITO DESC;
GO

-- 7) Un artículo de ejemplo searched por código
SELECT TOP 20 ID_ARTICULO, COLOR, TALLE, NOMBRE_COMPLETO, MATERIAL, GRUPO, STOCK_MITO, PRECIO
FROM ZooLogic.vw_ARTICULOS_MITO
WHERE ID_ARTICULO LIKE 'ZH0602%'
ORDER BY ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO;
GO