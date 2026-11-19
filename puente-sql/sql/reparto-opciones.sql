/*
 * REPARTO MANUAL (Reposiciones / Transferencias > Reparto manual) — opciones de los filtros del paso 1.
 * Solo lectura. Una fila por opción: k = filtro, cod = valor, nom = nombre para mostrar.
 * Las mismas dimensiones que el tablero de Power BI (proveedor, material, temporada, año, línea,
 * familia, género = categoría del artículo en Dragon, grupo). Tarda ~2 s; el puente la guarda 1 hora.
 */
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#a') IS NOT NULL DROP TABLE #a;
SELECT LTRIM(RTRIM(a.ID_ART))       AS ID_ART,
       LTRIM(RTRIM(a.ID_PROV))      AS ID_PROV,
       LTRIM(RTRIM(a.ID_MATERIAL))  AS ID_MATERIAL,
       LTRIM(RTRIM(a.ID_TEMPORADA)) AS ID_TEMPORADA,
       CAST(a.[AÑO] AS int)         AS ANIO,
       LTRIM(RTRIM(a.ID_LINEA))     AS ID_LINEA,
       LTRIM(RTRIM(a.ID_FLIA))      AS ID_FLIA,
       UPPER(LTRIM(RTRIM(a.ID_GRUPO))) AS ID_GRUPO
  INTO #a
  FROM DWH.dbo.vw_DIM_ARTICULO a
 WHERE CHARINDEX(' ', RTRIM(a.ID_ART)) = 0;

SELECT 'prov' AS k, x.ID_PROV AS cod, MAX(LTRIM(RTRIM(p.PROVEEDOR))) AS nom
  FROM #a x LEFT JOIN DWH.dbo.vw_DIM_PROVEEDOR p ON LTRIM(RTRIM(p.ID_PROV)) = x.ID_PROV
 WHERE x.ID_PROV <> '' GROUP BY x.ID_PROV
UNION ALL
SELECT 'mat', x.ID_MATERIAL, MAX(LTRIM(RTRIM(m.MATERIAL)))
  FROM #a x LEFT JOIN DWH.dbo.vw_DIM_MATERIAL m ON LTRIM(RTRIM(m.ID_MATERIAL)) = x.ID_MATERIAL
 WHERE x.ID_MATERIAL <> '' GROUP BY x.ID_MATERIAL
UNION ALL
SELECT DISTINCT 'temp', x.ID_TEMPORADA, NULL FROM #a x WHERE x.ID_TEMPORADA <> ''
UNION ALL
SELECT DISTINCT 'anio', CAST(x.ANIO AS varchar(10)), NULL FROM #a x WHERE x.ANIO IS NOT NULL AND x.ANIO > 0
UNION ALL
SELECT 'linea', x.ID_LINEA, MAX(LTRIM(RTRIM(t.DESCRIP)))
  FROM #a x LEFT JOIN DRAGONFISH_MITO.ZooLogic.LINEA t ON RTRIM(t.COD) = x.ID_LINEA
 WHERE x.ID_LINEA <> '' GROUP BY x.ID_LINEA
UNION ALL
SELECT 'flia', x.ID_FLIA, MAX(LTRIM(RTRIM(t.DESCRIP)))
  FROM #a x LEFT JOIN DRAGONFISH_MITO.ZooLogic.FAMILIA t ON RTRIM(t.COD) = x.ID_FLIA
 WHERE x.ID_FLIA <> '' GROUP BY x.ID_FLIA
UNION ALL
SELECT 'grupo', x.ID_GRUPO, MAX(LTRIM(RTRIM(t.DESCRIP)))
  FROM #a x LEFT JOIN DRAGONFISH_MITO.ZooLogic.GRUPO t ON UPPER(RTRIM(t.COD)) = x.ID_GRUPO
 WHERE x.ID_GRUPO <> '' GROUP BY x.ID_GRUPO
UNION ALL
-- Género = categoría del artículo en Dragon (ART.CATEARTI → CATEGART)
SELECT 'gen', LTRIM(RTRIM(c.COD)), LTRIM(RTRIM(c.DESCRIP))
  FROM DRAGONFISH_MITO.ZooLogic.CATEGART c
 WHERE LTRIM(RTRIM(ISNULL(c.COD, ''))) <> '';

DROP TABLE #a;
