-- ============================================================
-- VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SUCURSALES_REAL
-- Stock real por articulo/color/talle/base (una fila por combinacion con
-- CANTIDAD_REAL <> 0). Corre en la instancia local DESKTOP-OA4GU6I.
--
-- Bases:
--   NUEVO CENTRO -> DRAGONFISH_NVOCED2  (copia local en esta PC)
--   MUNOZ        -> DRAGONFISH_MUNOZ    (copia local en esta PC)
--   CARLOZ PAZ   -> DRAGONFISH_VCPD     (copia local en esta PC)
--   FALLAS       -> DRAGONFISH_FALLASD  (servidor principal, via OPENQUERY([MITO]))
--
-- Las tres primeras son copias locales: alcanza el nombre de 3 partes.
-- DRAGONFISH_FALLASD no esta copiada, asi que se lee del servidor principal
-- (servidor vinculado [MITO] = 192.168.0.222\ZOOLOGIC) con OPENQUERY: el filtro
-- COCANT <> 0 corre alla y por la red vienen solo las filas con stock.
-- Las columnas de texto del OPENQUERY se pasan a COLLATE DATABASE_DEFAULT
-- porque el servidor principal tiene otra colacion (SQL_Latin1_General_CP1_CI_AI
-- vs. Modern_Spanish_CI_AS local): sin eso el UNION ALL falla por conflicto.
--
-- Alimenta a vw_STOCK_ARTICULO_REAL (que suma CANTIDAD_REAL por articulo).
--
-- Aplicar:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/vw_STOCK_SUCURSALES_REAL.sql
-- Verificar: node scripts/sql.mjs --alias DESKTOP-OA4GU6I "SELECT BD_ORIGEN, COUNT(*) filas, SUM(CANTIDAD_REAL) unidades FROM VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SUCURSALES_REAL GROUP BY BD_ORIGEN"
-- ============================================================
USE [VISTAS_CONSOLIDADAS];
GO
SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO
CREATE OR ALTER VIEW [dbo].[vw_STOCK_SUCURSALES_REAL] AS
SELECT
    'NUEVO CENTRO' AS BD_ORIGEN,
    LTRIM(RTRIM(COART)) AS ARTICULO,
    LTRIM(RTRIM(COCOL)) AS COLOR,
    LTRIM(RTRIM(TALLE)) AS TALLE,
    CAST(ISNULL(COCANT, 0) AS numeric(12,2)) AS CANTIDAD_REAL
FROM [DRAGONFISH_NVOCED2].ZooLogic.COMB
WHERE CAST(ISNULL(COCANT, 0) AS numeric(12,2)) <> 0

UNION ALL
SELECT
    'MUNOZ' AS BD_ORIGEN,
    LTRIM(RTRIM(COART)) AS ARTICULO,
    LTRIM(RTRIM(COCOL)) AS COLOR,
    LTRIM(RTRIM(TALLE)) AS TALLE,
    CAST(ISNULL(COCANT, 0) AS numeric(12,2)) AS CANTIDAD_REAL
FROM [DRAGONFISH_MUNOZ].ZooLogic.COMB
WHERE CAST(ISNULL(COCANT, 0) AS numeric(12,2)) <> 0

UNION ALL
SELECT
    'CARLOZ PAZ' AS BD_ORIGEN,
    LTRIM(RTRIM(COART)) AS ARTICULO,
    LTRIM(RTRIM(COCOL)) AS COLOR,
    LTRIM(RTRIM(TALLE)) AS TALLE,
    CAST(ISNULL(COCANT, 0) AS numeric(12,2)) AS CANTIDAD_REAL
FROM [DRAGONFISH_VCPD].ZooLogic.COMB
WHERE CAST(ISNULL(COCANT, 0) AS numeric(12,2)) <> 0

UNION ALL
SELECT
    'FALLAS' AS BD_ORIGEN,
    CAST(A.ARTICULO AS varchar(50)) COLLATE DATABASE_DEFAULT AS ARTICULO,
    CAST(A.COLOR    AS varchar(50)) COLLATE DATABASE_DEFAULT AS COLOR,
    CAST(A.TALLE    AS varchar(50)) COLLATE DATABASE_DEFAULT AS TALLE,
    CAST(A.CANTIDAD_REAL AS numeric(12,2)) AS CANTIDAD_REAL
FROM OPENQUERY([MITO], '
    SELECT LTRIM(RTRIM(COART)) AS ARTICULO,
           LTRIM(RTRIM(COCOL)) AS COLOR,
           LTRIM(RTRIM(TALLE)) AS TALLE,
           CAST(ISNULL(COCANT, 0) AS numeric(12,2)) AS CANTIDAD_REAL
    FROM DRAGONFISH_FALLASD.ZooLogic.COMB
    WHERE CAST(ISNULL(COCANT, 0) AS numeric(12,2)) <> 0
') AS A;
GO
