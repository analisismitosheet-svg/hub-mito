/* =====================================================================
   F12 - CONSULTA ARTICULOS: vista para el hub (Mayorista)

   Una fila = un SKU: articulo + color + talle, con el stock de MITO.
   Es lo que lee /mayorista/consulta-articulos del Hub MITO a traves del
   proxy /api/sql (Hub -> Logic App -> Puente SQL -> esta vista).

   -------------------------------------------------------------------------
   Donde vive
   -------------------------------------------------------------------------
   Base VISTAS_CONSOLIDADAS, esquema dbo, en la instancia local
   (DESKTOP-OA4GU6I, la de esta PC). Ahí están las demás vistas
   consolidadas del hub (vw_STOCK_SUCURSALES_REAL, vw_comprobantes_*,
   vw_DETMSTOCK_UNIFICADA...).

   Los datos de MITO NO están en esta instancia: se leen por el servidor
   vinculado "MITO" (192.168.0.222\ZOOLOGIC) con nombre de 4 partes:

       MITO.DRAGONFISH_MITO.ZooLogic.<tabla>

   Ojo: sin el "MITO." adelante SQL Server busca [DRAGONFISH_MITO] entre las
   bases LOCALES, no lo encuentra y dice "Invalid object name". Esa base
   vive en la otra instancia.

   -------------------------------------------------------------------------
   Origen de cada columna (base DRAGONFISH_MITO, esquema ZooLogic)
   -------------------------------------------------------------------------
     ID_ARTICULO      COMB.COART        (BDALTAFW/BDMODIFW = 'MITO')
     COLOR            COL.COLDES        (codigo en COLOR_CODIGO)
     TALLE            TALLE.DESCRIP     (codigo en TALLE_CODIGO)
     NOMBRE_COMPLETO  ART.ARTDES + ART.ARTDESADIC
     MATERIAL         MAT.MATDES        (a traves de ART.MAT)
     GRUPO            ART.GRUPO
     STOCK_MITO       COMB, ver abajo
     PRECIO           PRECIOAR, lista LISTA2 (MAYOR), ver abajo
     PRECIO_CONTADO   PRECIOAR, lista LISTA1 (Contado) -- de apoyo
     SUCURSAL         siempre 'MITO'

   -------------------------------------------------------------------------
   Stock: se toma SOLO la fila de MITO
   -------------------------------------------------------------------------
   COMB tiene una fila por (sucursal, articulo, color, talle). La formula es
   la misma que usa ZooLogic.VISTA_SKU_COMPLETA (la vista que alimenta el
   Replicador y de la que salen stock y ubicaciones):

       disponible = COCANT - PEDIDO - PREPARADO,   nunca menor a 0

   Ojo: vw_PRODUCTOS_WEB usa otra formula (suma ENTRANSITO) y ademas NO filtra
   por sucursal, asi que mezcla las filas de todos los locales. Para "stock en
   MITO" no sirve.

   -------------------------------------------------------------------------
   Precio: lista LISTA2 = "MAYOR" (nombre en ZooLogic.LPRECIO)
   -------------------------------------------------------------------------
   El módulo es de Mayorista, así que el precio es el de mayorista. Es la misma
   lista que usa VISTA_SKU_COMPLETA. vw_PRODUCTOS_WEB, en cambio, usa LISTA1
   (Contado) y por eso no coincide.

   PRECIOAR guarda un renglón por lista, color y vigencia, así que se toma el
   de FECHAVIG más alta (desempatado por HMODIFW) para ese artículo+color; si
   el artículo no tiene precio propio del color se usa el general.

   -------------------------------------------------------------------------
   Correr:  node scripts/sql.mjs --alias -f sql/vw_ARTICULOS_MITO.sql
            (--alias = la instancia local; sin --alias cae en ZOOLOGIC, que
             NO tiene esta vista)
   Verificar:  node scripts/sql.mjs --alias -f sql/verificar_vw_ARTICULOS_MITO.sql
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_ARTICULOS_MITO
AS
WITH combos AS (
    SELECT
        LTRIM(RTRIM(C.COART))                 AS COART,
        LTRIM(RTRIM(C.COCOL))                 AS COCOL,
        LTRIM(RTRIM(C.TALLE))                 AS TALLE,
        CAST(ISNULL(C.COCANT, 0) AS INT)      AS STOCK_FISICO,
        CAST(ISNULL(C.ENTRANSITO, 0) AS INT) AS EN_TRANSITO,
        CAST(ISNULL(C.PEDIDO, 0) AS INT)      AS EN_PEDIDO,
        CAST(ISNULL(C.PREPARADO, 0) AS INT)   AS PREPARADO,
        CAST(CASE
            WHEN ISNULL(C.COCANT, 0) - ISNULL(C.PEDIDO, 0) - ISNULL(C.PREPARADO, 0) < 0
                THEN 0
            ELSE ISNULL(C.COCANT, 0) - ISNULL(C.PEDIDO, 0) - ISNULL(C.PREPARADO, 0)
        END AS INT)                           AS STOCK_MITO
    FROM MITO.DRAGONFISH_MITO.ZooLogic.COMB C
    WHERE C.BDALTAFW = 'MITO' AND C.BDMODIFW = 'MITO'
),
-- Las tablas maestras vienen repetidas por cada sucursal: una fila por código
colores AS (
    SELECT COCOL, MAX(CORDES) AS CORDES
    FROM (
        SELECT LTRIM(RTRIM(COLCOD)) AS COCOL, LTRIM(RTRIM(COLDES)) AS CORDES
        FROM MITO.DRAGONFISH_MITO.ZooLogic.COL
    ) X
    GROUP BY COCOL
),
talles AS (
    SELECT TCOD, MAX(TDES) AS TDES
    FROM (
        SELECT LTRIM(RTRIM(CODIGO)) AS TCOD, LTRIM(RTRIM(DESCRIP)) AS TDES
        FROM MITO.DRAGONFISH_MITO.ZooLogic.TALLE
    ) X
    GROUP BY TCOD
),
materiales AS (
    SELECT MATCOD, MAX(MATDES) AS MATDES
    FROM (
        SELECT LTRIM(RTRIM(MATCOD)) AS MATCOD, LTRIM(RTRIM(MATDES)) AS MATDES
        FROM MITO.DRAGONFISH_MITO.ZooLogic.MAT
    ) X
    GROUP BY MATCOD
),
-- Precio vigente de las dos listas que interesan, por artículo+color
precios AS (
    SELECT ARTICULO, CCOLOR, LISTAPRE, PDIRECTO
    FROM (
        SELECT
            LTRIM(RTRIM(P.ARTICULO))           AS ARTICULO,
            LTRIM(RTRIM(ISNULL(P.CCOLOR, ''))) AS CCOLOR,
            P.LISTAPRE,
            P.PDIRECTO,
            ROW_NUMBER() OVER (
                PARTITION BY P.LISTAPRE,
                             LTRIM(RTRIM(P.ARTICULO)),
                             LTRIM(RTRIM(ISNULL(P.CCOLOR, '')))
                ORDER BY P.FECHAVIG DESC, P.HMODIFW DESC
            ) AS rn
        FROM MITO.DRAGONFISH_MITO.ZooLogic.PRECIOAR P
        WHERE P.LISTAPRE IN ('LISTA2', 'LISTA1') AND P.PDIRECTO IS NOT NULL
    ) X
    WHERE rn = 1
)
SELECT
    CO.COART                                                    AS ID_ARTICULO,

    -- color: la descripción del maestro; si no hay, el código
    COALESCE(NULLIF(C.CORDES, ''), CO.COCOL)                   AS COLOR,
    CO.COCOL                                                    AS COLOR_CODIGO,

    -- talle: la descripción del maestro; si no hay, el código; si no hay talle, ÚNICO
    COALESCE(NULLIF(T.TDES, ''), NULLIF(CO.TALLE, ''), 'UNICO') AS TALLE,
    COALESCE(NULLIF(CO.TALLE, ''), 'UNICO')                     AS TALLE_CODIGO,

    -- nombre completo: descripción + descripción adicional
    CONCAT(
        NULLIF(LTRIM(RTRIM(A.ARTDES)), ''),
        CASE WHEN NULLIF(LTRIM(RTRIM(A.ARTDESADIC)), '') IS NOT NULL
             THEN CONCAT(' - ', LTRIM(RTRIM(A.ARTDESADIC))) ELSE '' END
    )                                                           AS NOMBRE_COMPLETO,

    NULLIF(M.MATDES, '')                                       AS MATERIAL,
    NULLIF(LTRIM(RTRIM(A.GRUPO)), '')                          AS GRUPO,

    CO.STOCK_MITO                                              AS STOCK_MITO,

    -- precio mayorista (LISTA2); si el color no tiene, el general del artículo
    CAST(COALESCE(PM.PDIRECTO, PMA.PDIRECTO) AS DECIMAL(18,2))  AS PRECIO,

    -- de apoyo: el hub los ignora, sirven para verificar la vista
    'MITO'                                                     AS SUCURSAL,
    CO.STOCK_FISICO                                            AS STOCK_FISICO,
    CO.EN_TRANSITO                                             AS EN_TRANSITO,
    CO.EN_PEDIDO                                               AS EN_PEDIDO,
    CO.PREPARADO                                               AS PREPARADO,
    CAST(COALESCE(PC.PDIRECTO, PCA.PDIRECTO) AS DECIMAL(18,2)) AS PRECIO_CONTADO,
    COALESCE(PM.LISTAPRE, PMA.LISTAPRE)                        AS LISTAPRE_MAYOR
FROM combos CO
LEFT JOIN talles T       ON T.TCOD = CO.TALLE
LEFT JOIN colores C      ON C.COCOL = CO.COCOL
LEFT JOIN MITO.DRAGONFISH_MITO.ZooLogic.ART A ON A.ARTCOD = CO.COART
LEFT JOIN materiales M   ON M.MATCOD = LTRIM(RTRIM(A.MAT))
LEFT JOIN precios PM  ON PM.ARTICULO = CO.COART AND PM.CCOLOR = CO.COCOL AND PM.LISTAPRE = 'LISTA2'
LEFT JOIN precios PMA ON PMA.ARTICULO = CO.COART AND PMA.CCOLOR = ''           AND PMA.LISTAPRE = 'LISTA2'
LEFT JOIN precios PC  ON PC.ARTICULO = CO.COART AND PC.CCOLOR = CO.COCOL AND PC.LISTAPRE = 'LISTA1'
LEFT JOIN precios PCA ON PCA.ARTICULO = CO.COART AND PCA.CCOLOR = ''           AND PCA.LISTAPRE = 'LISTA1'
WHERE NULLIF(CO.COART, '') IS NOT NULL
GO
