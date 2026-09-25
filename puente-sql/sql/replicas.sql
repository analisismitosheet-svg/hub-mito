-- ============================================================
-- Estado de las réplicas locales (se ejecuta en DESKTOP-OA4GU6I)
-- ============================================================
-- El Replicador SQL copia cada sucursal a una base de ESTA PC y registra,
-- en dbo._sync_estado de cada copia, la fecha de la última actualización
-- por tabla. Acá se toma el MAX por base.
--
-- Fijo, sin parámetros ni entrada del usuario: los nombres de base salen
-- de sys.databases y van entre corchetes (QUOTENAME). Lo llama server.js
-- con:  sqlcmd -S localhost -E -C -d master -h -1 -W -b -i replicas.sql
-- Cada línea de salida:  BASE|YYYY-MM-DD HH:MM:SS|CANT_TABLAS
-- (línea BASE||-1 = la base existe pero no se pudo leer)

SET NOCOUNT ON;
SET DATEFORMAT ymd;

CREATE TABLE #res (base sysname NOT NULL, ultima varchar(19) NULL, tablas int NOT NULL);

DECLARE @db sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT name
    FROM sys.databases
    WHERE state_desc = 'ONLINE'
      AND database_id > 4;
OPEN c;
FETCH NEXT FROM c INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'
IF OBJECT_ID(N''' + REPLACE(QUOTENAME(@db), '''', '''''') + N'.dbo._sync_estado'', ''U'') IS NOT NULL
    INSERT INTO #res (base, ultima, tablas)
    SELECT N''' + REPLACE(@db, '''', '''''') + N''',
           CONVERT(varchar(19), MAX(actualizado), 120),
           COUNT(*)
    FROM ' + QUOTENAME(@db) + N'.dbo._sync_estado;';
    BEGIN TRY
        EXEC sp_executesql @sql;
    END TRY
    BEGIN CATCH
        INSERT INTO #res (base, ultima, tablas) VALUES (@db, NULL, -1);
    END CATCH;
    FETCH NEXT FROM c INTO @db;
END
CLOSE c;
DEALLOCATE c;

SELECT base + '|' + ISNULL(ultima, '') + '|' + CAST(tablas AS varchar(11))
FROM #res
ORDER BY base;

DROP TABLE #res;
