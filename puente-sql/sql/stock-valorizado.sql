/* ============================================================================
   Stock valorizado a costo, por sucursal (Administradores > Stock valorizado)

   La corre el Puente SQL con la acción { accion: 'stock_valorizado' } contra el
   SQL Server principal (M1T0O1\ZOOLOGIC), que es donde viven TODAS las bases
   DRAGONFISH_* del grupo.

   Qué hace:
     1. Arma el costo por artículo con la lista de precios "Compra" (LISTA0) de
        DRAGONFISH_INDOD, tomando el registro más nuevo por FECHAVIG. El costo en
        Dragon está cargado por artículo (CCOLOR/TALLE vienen vacíos salvo un
        puñado de casos), así que se valoriza por artículo, no por SKU.
     2. Recorre cada base DRAGONFISH_* a la que el usuario del puente tiene
        acceso y que tiene la tabla ZooLogic.COMB (el stock por SKU: COART,
        COCOL, TALLE, COCANT) y suma unidades y unidades x costo.
     3. Devuelve cinco resultados:
          - una fila por base (unidades, valorizado, unidades sin costo, SKUs)
          - el top de artículos por valorizado, sumando todas las bases
          - una fila de contexto del costo (artículos con costo, última vigencia)
          - TODOS los artículos con stock y sin costo cargado (los que valen $0)
          - esos mismos, abiertos por sucursal (una fila por artículo y base).

   Los resultados se agregan al final y nunca se cambian de lugar: el puente los
   lee por posición, así que uno que todavía no conoce los últimos sigue
   encontrando los primeros donde siempre. Por eso el top de artículos sigue acá
   aunque la pantalla ya no lo muestre (28/10/2026, lo pidió sacar el usuario).

   Solo lectura: nada de INSERT/UPDATE/DELETE sobre las bases (las temporales
   #costo / #bases / #art son de la sesión y se tiran al cerrar).
   ============================================================================ */

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

/* ---- 0. Bases que NO van al informe ----
   Las pidió sacar el usuario (27/10/2026): no son stock propio para valorizar.
   Quedan afuera del total, del detalle por sucursal y del top de artículos, y
   además no se recorren (el cálculo tarda menos). Para volver a sumar una,
   borrar su línea y reiniciar el puente. */
IF OBJECT_ID('tempdb..#fuera') IS NOT NULL DROP TABLE #fuera;
CREATE TABLE #fuera (base sysname PRIMARY KEY);
INSERT INTO #fuera (base) VALUES
  ('DRAGONFISH_DRAGON'),
  ('DRAGONFISH_TEMPOD'),
  ('DRAGONFISH_CAPACITA'),
  ('DRAGONFISH_SHOWROOM'),
  ('DRAGONFISH_CHILE'),
  ('DRAGONFISH_REPOLOC'),
  ('DRAGONFISH_ROBOD'),
  ('DRAGONFISH_CONSIGNA');

/* ---- 1. Costo por artículo: lista "Compra" (LISTA0) de DRAGONFISH_INDOD ----
   La base de costos es INDO, no MITO (lo marcó el usuario el 28/10/2026): ahí
   está cargada la lista Compra entera (99.025 artículos contra 18.614 en MITO). */
IF OBJECT_ID('tempdb..#costo') IS NOT NULL DROP TABLE #costo;
CREATE TABLE #costo (art varchar(50) PRIMARY KEY, costo float, vigencia datetime);

INSERT INTO #costo (art, costo, vigencia)
SELECT art, costo, vigencia
  FROM (
    SELECT LTRIM(RTRIM(ARTICULO)) AS art,
           CAST(PDIRECTO AS float) AS costo,
           FECHAVIG AS vigencia,
           ROW_NUMBER() OVER (
             PARTITION BY LTRIM(RTRIM(ARTICULO))
             ORDER BY FECHAVIG DESC, HMODIFW DESC
           ) AS rn
      FROM DRAGONFISH_INDOD.ZooLogic.PRECIOAR
     WHERE LTRIM(RTRIM(LISTAPRE)) = 'LISTA0'
       AND LTRIM(RTRIM(ISNULL(ARTICULO, ''))) <> ''
  ) x
 WHERE rn = 1;

/* ---- 1b. Descripción por artículo: la de MITO y, lo que no está ahí, la de INDO.
   Se arma una sola vez en una temporal: salía mucho más caro repetir el join
   contra las dos tablas ART en cada agregación del final. ---- */
IF OBJECT_ID('tempdb..#desc') IS NOT NULL DROP TABLE #desc;
CREATE TABLE #desc (art varchar(50) PRIMARY KEY, descripcion varchar(200));

INSERT INTO #desc (art, descripcion)
SELECT art, MAX(descripcion)
  FROM (
    SELECT LTRIM(RTRIM(ARTCOD)) AS art, LTRIM(RTRIM(ISNULL(ARTDES, ''))) AS descripcion
      FROM DRAGONFISH_MITO.ZooLogic.ART
     WHERE LTRIM(RTRIM(ISNULL(ARTDES, ''))) <> ''
    UNION ALL
    SELECT LTRIM(RTRIM(ARTCOD)), LTRIM(RTRIM(ISNULL(ARTDES, '')))
      FROM DRAGONFISH_INDOD.ZooLogic.ART
     WHERE LTRIM(RTRIM(ISNULL(ARTDES, ''))) <> ''
  ) x
 WHERE art <> ''
 GROUP BY art;

/* ---- 2. Una pasada por base ---- */
IF OBJECT_ID('tempdb..#bases') IS NOT NULL DROP TABLE #bases;
CREATE TABLE #bases (base sysname, unidades float, valorizado float, unidades_sin_costo float, skus int);

IF OBJECT_ID('tempdb..#art') IS NOT NULL DROP TABLE #art;
CREATE TABLE #art (base sysname, art varchar(50), unidades float, valorizado float);

DECLARE @b sysname, @sql nvarchar(max);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
  SELECT d.name
    FROM sys.databases d
   WHERE d.database_id > 4
     AND d.state = 0
     AND HAS_DBACCESS(d.name) = 1
     AND d.name LIKE 'DRAGONFISH[_]%'
     AND d.name NOT LIKE '%[_]Publication[_]%'   -- bases internas de replicación
     AND NOT EXISTS (SELECT 1 FROM #fuera f WHERE f.base = d.name)
   ORDER BY d.name;

OPEN cur;
FETCH NEXT FROM cur INTO @b;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID(QUOTENAME(@b) + '.ZooLogic.COMB') IS NOT NULL
  BEGIN
    BEGIN TRY
      SET @sql = N'
        INSERT INTO #bases (base, unidades, valorizado, unidades_sin_costo, skus)
        SELECT @b,
               SUM(CAST(c.COCANT AS float)),
               SUM(CAST(c.COCANT AS float) * ISNULL(k.costo, 0)),
               SUM(CASE WHEN k.costo IS NULL THEN CAST(c.COCANT AS float) ELSE 0 END),
               COUNT(*)
          FROM ' + QUOTENAME(@b) + N'.ZooLogic.COMB c
          LEFT JOIN #costo k ON k.art = LTRIM(RTRIM(c.COART))
         WHERE c.COCANT > 0;

        INSERT INTO #art (base, art, unidades, valorizado)
        SELECT @b,
               LTRIM(RTRIM(c.COART)),
               SUM(CAST(c.COCANT AS float)),
               SUM(CAST(c.COCANT AS float) * ISNULL(k.costo, 0))
          FROM ' + QUOTENAME(@b) + N'.ZooLogic.COMB c
          LEFT JOIN #costo k ON k.art = LTRIM(RTRIM(c.COART))
         WHERE c.COCANT > 0
         GROUP BY LTRIM(RTRIM(c.COART));';
      EXEC sp_executesql @sql, N'@b sysname', @b = @b;
    END TRY
    BEGIN CATCH
      /* Una base caída, en recuperación o sin permisos no tumba el informe */
    END CATCH
  END
  FETCH NEXT FROM cur INTO @b;
END
CLOSE cur;
DEALLOCATE cur;

/* ---- 3. Resultados ---- */
SELECT base,
       ISNULL(unidades, 0) AS unidades,
       ISNULL(valorizado, 0) AS valorizado,
       ISNULL(unidades_sin_costo, 0) AS unidades_sin_costo,
       ISNULL(skus, 0) AS skus
  FROM #bases
 WHERE ISNULL(unidades, 0) <> 0
 ORDER BY valorizado DESC;

SELECT TOP 200
       a.art AS articulo,
       MAX(ISNULL(d.descripcion, '')) AS descripcion,
       SUM(a.unidades) AS unidades,
       SUM(a.valorizado) AS valorizado,
       MAX(k.costo) AS costo
  FROM #art a
  LEFT JOIN #costo k ON k.art = a.art
  LEFT JOIN #desc d ON d.art = a.art
 GROUP BY a.art
 ORDER BY SUM(a.valorizado) DESC;

SELECT COUNT(*) AS articulos_con_costo,
       MAX(vigencia) AS ultima_vigencia,
       MIN(vigencia) AS primera_vigencia
  FROM #costo;

/* Artículos con stock y SIN costo cargado en la lista Compra: son los que
   suman unidades y $0. Van todos (no hay TOP) para poder cargarles el costo.

   `unidades_val` son las que están en bases que SÍ valorizan algo; el resto
   (`unidades` - `unidades_val`) vive en las bases de insumos tipo NOMED, que la
   pantalla deja afuera del total salvo que se aprete el botón ámbar. Así el
   listado se filtra igual que el total y no arranca con 4.000 avíos. */
SELECT a.art AS articulo,
       MAX(ISNULL(d.descripcion, '')) AS descripcion,
       SUM(a.unidades) AS unidades,
       SUM(CASE WHEN v.base IS NOT NULL THEN a.unidades ELSE 0 END) AS unidades_val,
       COUNT(DISTINCT a.base) AS sucursales,
       STRING_AGG(REPLACE(a.base, 'DRAGONFISH_', ''), ' · ') WITHIN GROUP (ORDER BY a.base) AS bases
  FROM #art a
  LEFT JOIN #costo k ON k.art = a.art
  LEFT JOIN #desc d ON d.art = a.art
  LEFT JOIN (SELECT base FROM #bases WHERE ISNULL(valorizado, 0) > 0) v ON v.base = a.base
 WHERE k.costo IS NULL
 GROUP BY a.art
 ORDER BY SUM(CASE WHEN v.base IS NOT NULL THEN a.unidades ELSE 0 END) DESC, SUM(a.unidades) DESC;

/* Lo mismo, abierto por sucursal: una fila por artículo y base. Es lo que la
   pantalla despliega debajo de cada artículo para saber DÓNDE están esas
   unidades, y lo que baja a la hoja «Sin costo x sucursal» del Excel.
   `valoriza` marca si esa base suma al total (las de insumos tipo NOMED valen
   $0 enteras y quedan afuera salvo que se apriete el botón ámbar). */
SELECT a.art AS articulo,
       a.base,
       a.unidades,
       CASE WHEN v.base IS NOT NULL THEN 1 ELSE 0 END AS valoriza
  FROM #art a
  LEFT JOIN #costo k ON k.art = a.art
  LEFT JOIN (SELECT base FROM #bases WHERE ISNULL(valorizado, 0) > 0) v ON v.base = a.base
 WHERE k.costo IS NULL
 ORDER BY a.art, a.unidades DESC;
