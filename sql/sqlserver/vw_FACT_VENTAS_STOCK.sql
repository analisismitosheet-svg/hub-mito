USE [DWH]
GO

SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER VIEW [dbo].[vw_FACT_VENTAS_STOCK] AS
    /* ===================== DRAGONFISH_9DEJUL2 (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_9DEJUL2'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_9DEJUL2].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_9DEJUL2'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_9DEJUL2].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_9DEJUL2].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_9DEJUL2].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_9DEJUL2].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_9DEJUL2].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_9DEJUL2].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_9DEJUL2].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_9DEJUL2].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_9DEJULIO (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_9DEJULIO'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_9DEJULIO].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_9DEJULIO].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_9DEJULIO'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_9DEJULIO].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_9DEJULIO].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_9DEJULIO].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_9DEJULIO].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_9DEJULIO].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_9DEJULIO].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_9DEJULIO].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_BUSTOD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_BUSTOD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_BUSTOD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_BUSTOD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_BUSTOD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_BUSTOD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_BUSTOD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_BUSTOD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_BUSTOD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_BUSTOD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_BUSTOD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_BUSTOD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_CENTRALD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_CENTRALD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_CENTRALD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_CENTRALD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_CENTRALD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_CENTRALD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_CENTRALD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_CENTRALD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_CENTRALD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_CENTRALD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_CENTRALD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_CENTRALD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_CFD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_CFD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_CFD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_CFD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_CFD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_CFD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_CFD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_CFD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_CFD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_CFD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_CFD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_CFD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_CFPO (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_CFPO'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_CFPO].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_CFPO].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_CFPO'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_CFPO].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_CFPO].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_CFPO].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_CFPO].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_CFPO].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_CFPO].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_CFPO].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_CFR4 (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_CFR4'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_CFR4].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_CFR4].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_CFR4'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_CFR4].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_CFR4].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_CFR4].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_CFR4].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_CFR4].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_CFR4].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_CFR4].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_CFR9 (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_CFR9'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_CFR9].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_CFR9].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_CFR9'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_CFR9].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_CFR9].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_CFR9].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_CFR9].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_CFR9].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_CFR9].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_CFR9].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_CFRA (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_CFRA'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_CFRA].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_CFRA].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_CFRA'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_CFRA].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_CFRA].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_CFRA].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_CFRA].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_CFRA].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_CFRA].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_CFRA].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_DINOD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_DINOD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_DINOD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_DINOD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_DINOD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_DINOD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_DINOD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_DINOD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_DINOD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_DINOD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_DINOD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_DINOD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_ESPINOD (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_ESPINOD'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_ESPINOD].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_ESPINOD'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_ESPINOD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_ESPINOD].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_ESPINOD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_ESPINOD].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_ESPINOD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_ESPINOD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_ESPINOD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_ESPINOD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_FABRICA (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_FABRICA'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_FABRICA].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_FABRICA'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_FABRICA].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_FABRICA].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_FABRICA].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_FABRICA].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_FABRICA].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_FABRICA].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_FABRICA].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_FABRICA].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_GRALPAZ (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_GRALPAZ'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_GRALPAZ].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_GRALPAZ].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_GRALPAZ'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_GRALPAZ].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_GRALPAZ].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_GRALPAZ].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_GRALPAZ].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_GRALPAZ].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_GRALPAZ].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_GRALPAZ].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_INDO (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_INDO'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_INDO].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_INDO].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_INDO'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_INDO].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_INDO].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_INDO].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_INDO].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_INDO].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_INDO].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_INDO].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_INDOD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_INDOD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_INDOD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_INDOD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_INDOD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_INDOD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_INDOD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_INDOD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_INDOD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_INDOD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_INDOD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_INDOD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_LIBERD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_LIBERD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_LIBERD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_LIBERD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_LIBERD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_LIBERD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_LIBERD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_LIBERD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_LIBERD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_LIBERD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_LIBERD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_LIBERD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_MUNOZ (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_MUNOZ'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_MUNOZ].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_MUNOZ'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_MUNOZ].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_MUNOZ].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_MUNOZ].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_MUNOZ].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_MUNOZ].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_MUNOZ].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_MUNOZ].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_MUNOZ].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_NOMED (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_NOMED'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_NOMED].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_NOMED].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_NOMED'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_NOMED].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_NOMED].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_NOMED].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_NOMED].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_NOMED].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_NOMED].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_NOMED].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_NVOCED (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_NVOCED'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_NVOCED].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_NVOCED].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_NVOCED'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_NVOCED].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_NVOCED].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_NVOCED].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_NVOCED].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_NVOCED].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_NVOCED].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_NVOCED].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_NVOCED2 (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_NVOCED2'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_NVOCED2].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_NVOCED2'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_NVOCED2].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_NVOCED2].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_NVOCED2].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_NVOCED2].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_NVOCED2].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_NVOCED2].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_NVOCED2].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_NVOCED2].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_OUTLETD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_OUTLETD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_OUTLETD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_OUTLETD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_OUTLETD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_OUTLETD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_OUTLETD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_OUTLETD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_OUTLETD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_OUTLETD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_OUTLETD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_OUTLETD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_RIVERAD (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_RIVERAD'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_RIVERAD].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_RIVERAD'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_RIVERAD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_RIVERAD].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_RIVERAD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_RIVERAD].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_RIVERAD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_RIVERAD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_RIVERAD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_RIVERAD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_RUTA9D2 (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_RUTA9D2'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_RUTA9D2].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_RUTA9D2'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_RUTA9D2].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_RUTA9D2].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_RUTA9D2].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_RUTA9D2].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_RUTA9D2].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_RUTA9D2].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_RUTA9D2].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_RUTA9D2].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_TX-POLO (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_TX-POLO'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_TX-POLO].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_TX-POLO].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_TX-POLO'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_TX-POLO].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_TX-POLO].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_TX-POLO].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_TX-POLO].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_TX-POLO].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_TX-POLO].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_TX-POLO].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_VCPD (DESKTOP-OA4GU6I) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'                        AS HORA
        , ''                                AS COMPROBANTE
        , NULL                              AS PUNTO_VENTA
        , Q.COART COLLATE DATABASE_DEFAULT  AS ID_ART
        , Q.TALLE COLLATE DATABASE_DEFAULT  AS ID_TALLE
        , Q.COCOL COLLATE DATABASE_DEFAULT  AS ID_COLOR
        , Q.COCOD COLLATE DATABASE_DEFAULT  AS ID_COMB
        , Q.COCANT                          AS CANT
        , NULL                              AS MONTO
        , Q.ENTRANSITO
        , 'DRAGONFISH_VCPD'            AS Tienda
        , ''                                AS COD_CLIENTE
        , ''                                AS Cliente
        , 'STOCK'                           AS Tipo
        , ''                                AS Observaciones
        , NULL                              AS PROMO
        , NULL                              AS ID_PROMO
        , NULL                              AS DESC_PROMO
        , NULL                              AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT COART, TALLE, COCOL, COCOD, COCANT, ENTRANSITO
        FROM [DRAGONFISH_VCPD].ZooLogic.COMB
    ') AS Q

    UNION ALL

    SELECT Q.Fecha          COLLATE DATABASE_DEFAULT AS Fecha
        , Q.HORA            COLLATE DATABASE_DEFAULT AS HORA
        , Q.COMPROBANTE     COLLATE DATABASE_DEFAULT AS COMPROBANTE
        , Q.PUNTO_VENTA
        , Q.ID_ART          COLLATE DATABASE_DEFAULT AS ID_ART
        , Q.ID_TALLE        COLLATE DATABASE_DEFAULT AS ID_TALLE
        , Q.ID_COLOR        COLLATE DATABASE_DEFAULT AS ID_COLOR
        , Q.ID_COMB         COLLATE DATABASE_DEFAULT AS ID_COMB
        , Q.CANT
        , Q.MONTO
        , 0                                          AS ENTRANSITO
        , 'DRAGONFISH_VCPD'      AS Tienda
        , Q.COD_CLIENTE     COLLATE DATABASE_DEFAULT AS COD_CLIENTE
        , Q.Cliente         COLLATE DATABASE_DEFAULT AS Cliente
        , 'VENTA'                                    AS Tipo
        , Q.Observaciones   COLLATE DATABASE_DEFAULT AS Observaciones
        , Q.PROMO
        , Q.ID_PROMO        COLLATE DATABASE_DEFAULT AS ID_PROMO
        , Q.DESC_PROMO      COLLATE DATABASE_DEFAULT AS DESC_PROMO
        , Q.VENDEDOR        COLLATE DATABASE_DEFAULT AS VENDEDOR
    FROM OPENQUERY([DESKTOP-OA4GU6I], '
        SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
            , cab.HALTAFW AS HORA
            , CAST([DRAGONFISH_VCPD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
            , cab.FPTOVEN AS PUNTO_VENTA
            , FART        AS ID_ART
            , det.TALLE   AS ID_TALLE
            , CCOLOR      AS ID_COLOR
            , COALESCE(COMB.COCOD, RTRIM(FART) + '' '' + RTRIM(CCOLOR) + '' '' + RTRIM(det.TALLE)) AS ID_COMB
            , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
            , MNTPTOT * SIGNOMOV AS MONTO
            , FPERSON     AS COD_CLIENTE
            , FCLIENTE    AS Cliente
            , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
            , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
            , PD.PROMO    AS ID_PROMO
            , P.DESCRIP   AS DESC_PROMO
            , V.CLNOM     AS VENDEDOR
        FROM [DRAGONFISH_VCPD].ZooLogic.COMPROBANTEV cab
        INNER JOIN [DRAGONFISH_VCPD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
        OUTER APPLY (
            SELECT TOP 1 x.PROMO, x.CANTIDAD
            FROM [DRAGONFISH_VCPD].ZooLogic.PROMDET x
            WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
            ORDER BY x.PROMO
        ) PD
        LEFT JOIN [DRAGONFISH_VCPD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
        LEFT JOIN [DRAGONFISH_VCPD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
        LEFT JOIN [DRAGONFISH_VCPD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                            AND COMB.COCOL = CCOLOR
                                            AND COMB.TALLE = det.TALLE
        WHERE [DRAGONFISH_VCPD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
          AND FFCH >= ''2025-01-01''
    ') AS Q

    UNION ALL

    /* ===================== DRAGONFISH_WALMARTD (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_WALMARTD'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_WALMARTD].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_WALMARTD].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_WALMARTD'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_WALMARTD].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_WALMARTD].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_WALMARTD].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_WALMARTD].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_WALMARTD].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_WALMARTD].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_WALMARTD].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_POLO52 (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_POLO52'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_POLO52].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_POLO52].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_POLO52'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_POLO52].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_POLO52].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_POLO52].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_POLO52].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_POLO52].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_POLO52].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_POLO52].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'

    UNION ALL

    /* ===================== DRAGONFISH_MITO (M1T0O1\ZOOLOGIC) ===================== */
    SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS Fecha
        , '00:00:00'        AS HORA
        , ''                AS COMPROBANTE
        , NULL              AS PUNTO_VENTA
        , COART             AS ID_ART
        , TALLE             AS ID_TALLE
        , COCOL             AS ID_COLOR
        , COCOD             AS ID_COMB
        , COCANT            AS CANT
        , NULL              AS MONTO
        , ENTRANSITO
        , 'DRAGONFISH_MITO'            AS Tienda
        , ''                AS COD_CLIENTE
        , ''                AS Cliente
        , 'STOCK'           AS Tipo
        , ''                AS Observaciones
        , NULL              AS PROMO
        , NULL              AS ID_PROMO
        , NULL              AS DESC_PROMO
        , NULL              AS VENDEDOR
    FROM [DRAGONFISH_MITO].ZooLogic.COMB

    UNION ALL

    SELECT CONVERT(NVARCHAR(30), FFCH, 120) AS Fecha
        , cab.HALTAFW AS HORA
        , CAST([DRAGONFISH_MITO].Funciones.IdentificadorDeComprobanteParaListado(cab.FACTTIPO, cab.FLETRA, cab.FPTOVEN, cab.FNUMCOMP) AS VARCHAR(26)) AS COMPROBANTE
        , cab.FPTOVEN AS PUNTO_VENTA
        , FART        AS ID_ART
        , det.TALLE   AS ID_TALLE
        , CCOLOR      AS ID_COLOR
        , COALESCE(COMB.COCOD, RTRIM(FART) + ' ' + RTRIM(CCOLOR) + ' ' + RTRIM(det.TALLE)) AS ID_COMB
        , CASE WHEN COMB.COART IS NULL THEN 0 ELSE FCANT * SIGNOMOV END AS CANT
        , MNTPTOT * SIGNOMOV AS MONTO
        , 0           AS ENTRANSITO
        , 'DRAGONFISH_MITO'      AS Tienda
        , FPERSON     AS COD_CLIENTE
        , FCLIENTE    AS Cliente
        , 'VENTA'     AS Tipo
        , CONVERT(VARCHAR(MAX), FOBS) AS Observaciones
        , ISNULL(PD.CANTIDAD, 0) * SIGNOMOV AS PROMO
        , PD.PROMO    AS ID_PROMO
        , P.DESCRIP   AS DESC_PROMO
        , V.CLNOM     AS VENDEDOR
    FROM [DRAGONFISH_MITO].ZooLogic.COMPROBANTEV cab
    INNER JOIN [DRAGONFISH_MITO].ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
    OUTER APPLY (
        SELECT TOP 1 x.PROMO, x.CANTIDAD
        FROM [DRAGONFISH_MITO].ZooLogic.PROMDET x
        WHERE x.codigo = cab.codigo AND x.NROITEM = det.NROITEM
        ORDER BY x.PROMO
    ) PD
    LEFT JOIN [DRAGONFISH_MITO].ZooLogic.PROMOS P ON P.CODIGO = PD.PROMO
    LEFT JOIN [DRAGONFISH_MITO].ZooLogic.VEN    V ON V.CLCOD  = cab.FVEN
    LEFT JOIN [DRAGONFISH_MITO].ZooLogic.COMB  COMB ON COMB.COART = FART
                                        AND COMB.COCOL = CCOLOR
                                        AND COMB.TALLE = det.TALLE
    WHERE [DRAGONFISH_MITO].Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN ('TFC','FEN','TNC','CEN','FCV','NCV')
      AND FFCH >= '2025-01-01'
GO
