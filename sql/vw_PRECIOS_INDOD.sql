/* =====================================================================
   DEPÓSITO - F12 INDO: precios LISTA1 y LISTA4 de DRAGONFISH_INDOD

   Filas crudas de PRECIOAR (sin ventana ni recortes) para que el filtro
   ARTICULO = @v viaje al servidor de Dragon y use su índice: el F12 de
   Depósito la pide por cada artículo encontrado y elige en el navegador
   el precio vigente (el del color o el general, la FECHAVIG más nueva).
   Calcular la vigencia acá obligaba a traer ~630 000 filas en cada búsqueda.

   Correr:  node scripts/sql.mjs --alias DESKTOP-OA4GU6I -f sql/vw_PRECIOS_INDOD.sql
   Habilitarla en el hub: Configuraciones > Conexión SQL (config_app 'sql_vistas').
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_PRECIOS_INDOD
AS
SELECT
    P.ARTICULO,
    ISNULL(P.CCOLOR, '')                 AS CCOLOR,
    P.LISTAPRE,
    CAST(P.PDIRECTO AS DECIMAL(18,2))    AS PDIRECTO,
    P.FECHAVIG,
    P.HMODIFW
FROM MITO.DRAGONFISH_INDOD.ZooLogic.PRECIOAR P
WHERE P.LISTAPRE IN ('LISTA1', 'LISTA4') AND P.PDIRECTO IS NOT NULL;
GO
