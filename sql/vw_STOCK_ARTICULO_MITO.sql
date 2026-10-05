/* =====================================================================
   MAPEO DEPÓSITO - stock por artículo (suma de sus SKUs)

   El mapeo guarda solo el artículo (sin color ni talle), así que para
   mostrar el stock al lado del código hace falta el TOTAL del artículo:
   una fila por ID_ARTICULO con la suma de STOCK_MITO de todos sus
   colores y talles.

   La arma sobre vw_ARTICULOS_MITO (la misma que lee F12 Consulta
   artículos): así el número es idéntico al de esa pantalla y la fórmula
   de stock (COCANT - PEDIDO - PREPARADO, piso 0, solo sucursal MITO)
   está definida en un solo lugar.

   Peso: ~2 400 filas x 2 columnas (la vista origen trae ~17 700 SKUs).

   -------------------------------------------------------------------------
   Correr:  node scripts/sql.mjs --alias -f sql/vw_STOCK_ARTICULO_MITO.sql
            (--alias = la instancia local; sin --alias cae en ZOOLOGIC, que
             NO tiene estas vistas)
   Verificar:
            node scripts/sql.mjs --alias "SELECT COUNT(*) filas, SUM(STOCK_MITO) stock FROM VISTAS_CONSOLIDADAS.dbo.vw_STOCK_ARTICULO_MITO"
   Después de crearla: habilitarla en el hub, Configuraciones > Conexión SQL
   (servidor DESKTOP-OA4GU6I -> base VISTAS_CONSOLIDADAS -> esquema dbo ->
   vw_STOCK_ARTICULO_MITO) y subir el tope de filas a 3000 o más, así el
   stock llega completo a la pantalla de Orden mapeado.
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_STOCK_ARTICULO_MITO
AS
SELECT
    ID_ARTICULO,
    CAST(SUM(STOCK_MITO) AS INT) AS STOCK_MITO
FROM dbo.vw_ARTICULOS_MITO
WHERE NULLIF(LTRIM(RTRIM(ID_ARTICULO)), '') IS NOT NULL
GROUP BY ID_ARTICULO;
GO
