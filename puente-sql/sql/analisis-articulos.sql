/*
 * ANÁLISIS VENTAS: maestro de artículos con las tipificaciones del Reparto manual
 * (proveedor, material, temporada, año, línea, familia, género = categoría en Dragon, grupo).
 * Mismo origen que sql/reparto-foto.sql (DWH.dbo.vw_DIM_ARTICULO + ART.CATEARTI de DRAGONFISH_MITO).
 * Solo lectura, ~4 s. El puente lo guarda 6 horas (y en D:\memoria ia para los reinicios).
 */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#m') IS NOT NULL DROP TABLE #m;
SELECT LTRIM(RTRIM(a.ID_ART))                AS ID_ART,
       LTRIM(RTRIM(a.ARTICULO))              AS ARTICULO,
       UPPER(LTRIM(RTRIM(a.ID_PROV)))        AS ID_PROV,
       UPPER(LTRIM(RTRIM(a.ID_GRUPO)))       AS ID_GRUPO,
       UPPER(LTRIM(RTRIM(a.ID_FLIA)))        AS ID_FLIA,
       UPPER(LTRIM(RTRIM(a.ID_LINEA)))       AS ID_LINEA,
       UPPER(LTRIM(RTRIM(a.ID_MATERIAL)))    AS ID_MATERIAL,
       UPPER(LTRIM(RTRIM(a.ID_TEMPORADA)))   AS ID_TEMPORADA,
       CAST(CAST(a.[AÑO] AS int) AS varchar(10)) AS ANIO
  INTO #m
  FROM DWH.dbo.vw_DIM_ARTICULO a
 WHERE CHARINDEX(' ', RTRIM(a.ID_ART)) = 0;

IF OBJECT_ID('tempdb..#g') IS NOT NULL DROP TABLE #g;
SELECT LTRIM(RTRIM(z.ARTCOD)) AS ID_ART, MAX(UPPER(LTRIM(RTRIM(z.CATEARTI)))) AS GEN
  INTO #g
  FROM DRAGONFISH_MITO.ZooLogic.ART z
 GROUP BY LTRIM(RTRIM(z.ARTCOD));

SELECT m.*, g.GEN
  FROM #m m
  LEFT JOIN #g g ON g.ID_ART COLLATE DATABASE_DEFAULT = m.ID_ART COLLATE DATABASE_DEFAULT;

DROP TABLE #m;
DROP TABLE #g;
