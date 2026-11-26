/*
 * ANÁLISIS VENTAS (Compras > Análisis ventas del hub): venta por ticket y artículo.
 *
 * Lee COMPROBANTEV/COMPROBANTEVDET de cada base SOLO en las fechas pedidas (FFCH tiene índice),
 * con los mismos criterios que DWH.dbo.vw_FACT_VENTAS_STOCK:
 *   - comprobantes TFC, FEN, TNC, CEN, FCV, NCV
 *   - CANT  = FCANT * SIGNOMOV, 0 si el SKU no existe en la COMB de la base (LEFT JOIN igual que la vista)
 *   - MONTO = MNTPTOT * SIGNOMOV (total del renglón con IVA, devoluciones en negativo)
 * Se agrupa por comprobante y artículo (color y talle no hacen falta para las tipificaciones).
 * v = 1 si el comprobante es de venta (TFC/FEN/FCV): solo esos cuentan como ticket.
 *
 * El mismo script corre en los dos servidores (réplicas de esta PC + principal): server.js le pasa
 * a cada uno su lista de bases (@bases, separadas por coma). Solo lectura.
 * Parámetros: @desde, @hasta ('YYYY-MM-DD', inclusive), @bases.
 *
 * Resultados:
 *   1) renglones: dia, Tienda, tk (código del comprobante), v, art, cant, monto
 *   2) bases    : base, ok, error
 */
SET NOCOUNT ON;

DECLARE @d date = CONVERT(date, @desde, 23), @h date = DATEADD(day, 1, CONVERT(date, @hasta, 23));

CREATE TABLE #r (dia char(10) NOT NULL, Tienda sysname NOT NULL, tk varchar(60) NOT NULL, v bit NOT NULL,
                 art varchar(60) NOT NULL, cant int NOT NULL, monto decimal(18, 2) NOT NULL);
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
INSERT INTO #r (dia, Tienda, tk, v, art, cant, monto)
SELECT CONVERT(char(10), x.FFCH, 120), @tienda, x.tk, x.v, x.art,
       SUM(x.cant), SUM(x.monto)
  FROM (
    SELECT cab.FFCH, LTRIM(RTRIM(cab.CODIGO)) AS tk,
           CASE WHEN ' + QUOTENAME(@db) + N'.Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''FCV'') THEN 1 ELSE 0 END AS v,
           LTRIM(RTRIM(det.FART)) AS art,
           CASE WHEN COMB.COART IS NULL THEN 0 ELSE CAST(det.FCANT * cab.SIGNOMOV AS int) END AS cant,
           ISNULL(det.MNTPTOT, 0) * cab.SIGNOMOV AS monto
      FROM ' + QUOTENAME(@db) + N'.ZooLogic.COMPROBANTEV cab
      JOIN ' + QUOTENAME(@db) + N'.ZooLogic.COMPROBANTEVDET det ON det.codigo = cab.codigo
      LEFT JOIN ' + QUOTENAME(@db) + N'.ZooLogic.COMB COMB
             ON COMB.COART = det.FART AND COMB.COCOL = det.CCOLOR AND COMB.TALLE = det.TALLE
     WHERE cab.FFCH >= @d AND cab.FFCH < @h
       AND ' + QUOTENAME(@db) + N'.Funciones.ObtenerIdentificadorDeComprobante(cab.FACTTIPO) IN (''TFC'',''FEN'',''TNC'',''CEN'',''FCV'',''NCV'')
  ) x
 GROUP BY CONVERT(char(10), x.FFCH, 120), x.tk, x.v, x.art;';
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

SELECT dia, Tienda, tk, v, art, cant, monto FROM #r;

SELECT base, ok, error FROM #b
UNION ALL
SELECT LTRIM(RTRIM(value)), 0, N'No está en este servidor'
  FROM STRING_SPLIT(@bases, ',')
 WHERE LTRIM(RTRIM(value)) <> '' AND LTRIM(RTRIM(value)) NOT IN (SELECT base FROM #b);

DROP TABLE #r;
DROP TABLE #b;
