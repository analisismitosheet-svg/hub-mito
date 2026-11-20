/* =====================================================================
   DEPÓSITO - F12 Consulta artículos INDO (/deposito/consulta-articulos)

   Igual que vw_ARTICULOS_MITO (F12 del mayorista) pero sobre la base
   DRAGONFISH_INDOD: una fila por artículo + color + talle con el stock
   del depósito Indo. Los precios (LISTA1 y LISTA4) NO van acá: los pide
   el F12 aparte, por artículo, a vw_PRECIOS_INDOD (calcularlos en esta
   vista hacía que buscar por nombre tardara más de 15 s).

   La lee SOLO el F12 de Depósito (src/lib/articulosConsulta.ts con
   VISTA_ARTICULOS_INDOD). El F12 del mayorista sigue con vw_ARTICULOS_MITO.

   -------------------------------------------------------------------------
   Correr:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/vw_ARTICULOS_INDOD.sql
   Verificar:
            node scripts/sql.mjs --alias DESKTOP-OA4GU6I "SELECT * FROM VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_INDOD WHERE ID_ARTICULO='RC261400'"
   Habilitarla en el hub: Configuraciones > Conexión SQL (config_app 'sql_vistas').
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_ARTICULOS_INDOD
AS
WITH combos AS (
    SELECT
        LTRIM(RTRIM(C.COART))                 AS COART,
        LTRIM(RTRIM(C.COCOL))                 AS COCOL,
        LTRIM(RTRIM(C.TALLE))                 AS TALLE,
        CAST(ISNULL(C.COCANT, 0) AS INT)      AS STOCK_FISICO,
        CAST(ISNULL(C.PEDIDO, 0) AS INT)      AS EN_PEDIDO,
        CAST(ISNULL(C.PREPARADO, 0) AS INT)   AS PREPARADO
    FROM MITO.DRAGONFISH_INDOD.ZooLogic.COMB C
    WHERE C.BDALTAFW = 'INDOD' AND C.BDMODIFW = 'INDOD'
),
colores AS (
    SELECT COCOL, MAX(CORDES) AS CORDES
    FROM (
        SELECT LTRIM(RTRIM(COLCOD)) AS COCOL, LTRIM(RTRIM(COLDES)) AS CORDES
        FROM MITO.DRAGONFISH_INDOD.ZooLogic.COL
    ) X
    GROUP BY COCOL
),
talles AS (
    SELECT TCOD, MAX(TDES) AS TDES
    FROM (
        SELECT LTRIM(RTRIM(CODIGO)) AS TCOD, LTRIM(RTRIM(DESCRIP)) AS TDES
        FROM MITO.DRAGONFISH_INDOD.ZooLogic.TALLE
    ) X
    GROUP BY TCOD
),
materiales AS (
    SELECT MATCOD, MAX(MATDES) AS MATDES
    FROM (
        SELECT LTRIM(RTRIM(MATCOD)) AS MATCOD, LTRIM(RTRIM(MATDES)) AS MATDES
        FROM MITO.DRAGONFISH_INDOD.ZooLogic.MAT
    ) X
    GROUP BY MATCOD
)
SELECT
    CO.COART                                                    AS ID_ARTICULO,
    COALESCE(NULLIF(C.CORDES, ''), CO.COCOL)                   AS COLOR,
    CO.COCOL                                                    AS COLOR_CODIGO,
    COALESCE(NULLIF(T.TDES, ''), NULLIF(CO.TALLE, ''), 'UNICO') AS TALLE,
    COALESCE(NULLIF(CO.TALLE, ''), 'UNICO')                     AS TALLE_CODIGO,
    CONCAT(
        NULLIF(LTRIM(RTRIM(A.ARTDES)), ''),
        CASE WHEN NULLIF(LTRIM(RTRIM(A.ARTDESADIC)), '') IS NOT NULL
              AND LTRIM(RTRIM(A.ARTDESADIC)) <> LTRIM(RTRIM(A.ARTDES))
             THEN CONCAT(' - ', LTRIM(RTRIM(A.ARTDESADIC))) ELSE '' END
    )                                                           AS NOMBRE_COMPLETO,
    NULLIF(M.MATDES, '')                                       AS MATERIAL,
    NULLIF(LTRIM(RTRIM(A.GRUPO)), '')                          AS GRUPO,
    CO.STOCK_FISICO                                            AS STOCK_FISICO,
    CO.EN_PEDIDO                                               AS EN_PEDIDO,
    'INDOD'                                                    AS SUCURSAL,
    CO.PREPARADO                                               AS PREPARADO
FROM combos CO
LEFT JOIN talles T       ON T.TCOD = CO.TALLE
LEFT JOIN colores C      ON C.COCOL = CO.COCOL
LEFT JOIN MITO.DRAGONFISH_INDOD.ZooLogic.ART A ON A.ARTCOD = CO.COART
LEFT JOIN materiales M   ON M.MATCOD = LTRIM(RTRIM(A.MAT))
WHERE NULLIF(CO.COART, '') IS NOT NULL;
GO
