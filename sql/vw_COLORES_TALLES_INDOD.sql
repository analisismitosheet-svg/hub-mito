/* =====================================================================
   DEPÓSITO - Control físico (/deposito/control-fisico), 27/11/2026

   Maestros de colores y talles de DRAGONFISH_INDOD para el desglose de
   los renglones del picking que vienen como color 00 / talle U. En Dragon
   Indo esos artículos están dados de alta solo como 00 / UNICO, así que
   los colores y talles reales salen de los maestros generales.

   Solo lectura (no toca Dragon). En vivo: un color dado de alta hoy en
   Dragon aparece ya en el hub.

   -------------------------------------------------------------------------
   Correr:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/vw_COLORES_TALLES_INDOD.sql
   Verificar:
            node scripts/sql.mjs --alias DESKTOP-OA4GU6I "SELECT COUNT(*) FROM VISTAS_CONSOLIDADAS.dbo.vw_COLORES_INDOD"
   Habilitarlas en el hub: config_app 'sql_vistas' (lo hace sql/control_fisico.sql).
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_COLORES_INDOD
AS
SELECT CODIGO, MAX(DESCRIPCION) AS DESCRIPCION
FROM (
    SELECT LTRIM(RTRIM(COLCOD)) AS CODIGO, LTRIM(RTRIM(COLDES)) AS DESCRIPCION
    FROM MITO.DRAGONFISH_INDOD.ZooLogic.COL
) X
WHERE CODIGO <> ''
GROUP BY CODIGO;
GO

CREATE OR ALTER VIEW dbo.vw_TALLES_INDOD
AS
SELECT CODIGO, MAX(DESCRIPCION) AS DESCRIPCION
FROM (
    SELECT LTRIM(RTRIM(CODIGO)) AS CODIGO, LTRIM(RTRIM(DESCRIP)) AS DESCRIPCION
    FROM MITO.DRAGONFISH_INDOD.ZooLogic.TALLE
) X
WHERE CODIGO <> ''
GROUP BY CODIGO;
GO
