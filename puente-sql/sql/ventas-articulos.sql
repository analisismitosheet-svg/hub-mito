/*
 * VENTAS POR ARTÍCULO (Chat IA del hub: "¿qué fue lo más vendido hoy/ayer?").
 *
 * Reemplaza leer DWH.dbo.vw_FACT_VENTAS_STOCK (que recorre ~28 bases enteras desde 2025,
 * parte por OPENQUERY, y tarda ~1 minuto): acá se lee COMPROBANTEV/COMPROBANTEVDET de cada
 * base SOLO en las fechas pedidas (FFCH es fecha de verdad, con índice).
 *
 * El mismo script corre en los dos servidores:
 *   - DESKTOP-OA4GU6I (esta PC): las réplicas que copia el Replicador SQL (9DEJUL2, CFU, ...)
 *   - M1T0O1\ZOOLOGIC (principal): el resto de las bases DRAGONFISH_*
 * server.js le pasa a cada uno su lista de bases (@bases, separadas por coma).
 *
 * Mismos criterios que la vista:
 *   - comprobantes TFC, FEN, TNC, CEN, FCV, NCV; CANT = FCANT * SIGNOMOV (devoluciones en negativo)
 *   - CANT = 0 si el SKU no existe en la COMB de la base (LEFT JOIN igual que la vista)
 * Y los de la repo diaria (repo-diaria.sql): ID_ART sin "1P" (distingue mayúsculas),
 * renglones con CANT > 0 para el ranking. NVOCED2 -> NVOCED lo hace repo-diaria.js.
 *
 * Solo lectura. Parámetros: @desde, @hasta ('YYYY-MM-DD', inclusive), @bases.
 * Las bases se validan contra sys.databases y van con QUOTENAME.
 *
 * Resultados:
 *   1) días   : dia, unidades (toda la venta, también devoluciones), por base
 *   2) ventas : dia, Tienda, ID_ART, ID_COLOR, ID_TALLE, cant (renglones > 0)
 *   3) bases  : base, ok, error (las que no se pudieron leer no frenan al resto)
 */
SET NOCOUNT ON;

DECLARE @d date = CONVERT(date, @desde, 23), @h date = DATEADD(day, 1, CONVERT(date, @hasta, 23));

CREATE TABLE #v (dia char(10) NOT NULL, Tienda sysname NOT NULL, ID_ART varchar(60) NOT NULL,
                 ID_COLOR varchar(60) NOT NULL, ID_TALLE varchar(60) NOT NULL, CANT int NOT NULL);
CREATE TABLE #b (base sysname NOT NULL, ok bit NOT NULL, error nvarchar(400) NULL);

DECLARE @db sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT d.name
      FROM sys.databases d
      JOIN (SELECT LTRIM(RTRIM(value)) AS name FROM STRING_SPLIT(@bases, ',')) p ON p.name = d.name
     WHERE d.state_desc = 'ONLINE';
OPEN c;
FETCH NEXT FROM c INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'
INSERT INTO #v (dia, Tienda, ID_ART, ID_COLOR, ID_TALLE, CANT)
SELECT CONVERT(char(10), cab.FFCH, 120), @tienda,
       LTRIM(RTRIM(det.FART)), LTRIM(RTRIM(det.CCOLOR)), LTRIM(RTRIM(det.TALLE)),
       CASE WHEN COMB.COART IS NULL THEN 0 ELSE CAST(det.FCANT * cab.SIGNOMOV AS int) END
  FROM ' + QUOTENAME(@db) + N'.ZooLogic.COMPROBANTEV cab
  JOIN ' + QUOTENAME(@db) + N'.ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
  LEFT JOIN ' + QUOTENAME(@db) + N'.ZooLogic.COMB COMB
         ON COMB.COART = det.FART AND COMB.COCOL = det.CCOLOR AND COMB.TALLE = det.TALLE
 WHERE cab.FFCH >= @d AND cab.FFCH < @h
   AND ' + QUOTENAME(@db) + N'.Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
   AND det.FART COLLATE Latin1_General_BIN NOT LIKE ''%1P%'';';
    BEGIN TRY
        EXEC sp_executesql @sql, N'@tienda sysname, @d date, @h date', @tienda = @db, @d = @d, @h = @h;
        INSERT INTO #b (base, ok) VALUES (@db, 1);
    END TRY
    BEGIN CATCH
        INSERT INTO #b (base, ok, error) VALUES (@db, 0, LEFT(ERROR_MESSAGE(), 400));
    END CATCH;
    FETCH NEXT FROM c INTO @db;
END
CLOSE c;
DEALLOCATE c;

-- 1) Unidades por día y base (toda la venta, también devoluciones, como day_totals de la repo)
SELECT dia, Tienda, SUM(CANT) AS unidades FROM #v GROUP BY dia, Tienda;

-- 2) Venta por día, tienda y SKU: solo renglones positivos (como repo-diaria.sql)
SELECT dia, Tienda, ID_ART, ID_COLOR, ID_TALLE, SUM(CANT) AS cant
  FROM #v
 WHERE CANT > 0
 GROUP BY dia, Tienda, ID_ART, ID_COLOR, ID_TALLE;

-- 3) Bases leídas (y las pedidas que no existen en este servidor)
SELECT base, ok, error FROM #b
UNION ALL
SELECT LTRIM(RTRIM(value)), 0, N'No está en este servidor'
  FROM STRING_SPLIT(@bases, ',')
 WHERE LTRIM(RTRIM(value)) <> '' AND LTRIM(RTRIM(value)) NOT IN (SELECT base FROM #b);

DROP TABLE #v;
DROP TABLE #b;
