/* =====================================================================
   F12 · CONSULTA ARTÍCULOS — vista para el hub (Mayorista)

   Una fila = un SKU: artículo + color + talle. Es lo que lee
   /mayorista/consulta-articulos del Hub MITO a través del proxy /api/sql.

   EJECUTAR EN EL SQL SERVER DE MITO (base DRAGONFISH_MITO) con un usuario
   que pueda leer ZooLogic.vw_PRODUCTOS_WEB.

   ---------------------------------------------------------------------
   ANTES DE CORRER: revisá que los nombres de columna de abajo existan.
   La fuente (vw_PRODUCTOS_WEB) tiene, entre otras, estas columnas:
       ARTCOD, ARTDES, ARTDESADIC, ARTFAB, GRUPO,
       TALLE, TALLE_DESCRIPCION, COLOR, COLOR_CODIGO,
       STOCK_DISPONIBLE, PRECIO

   Lo único que puede cambiar en tu base es MATERIAL: si tu vista no tiene
   una columna con ese nombre, comentá la línea de MATERIAL (y el SELECT la
   va a mostrar como texto vacío) o poné la que corresponda, por ejemplo
   W.DESCRIP_MATERIAL o W.MATEL. La pantalla tolera que falte: muestra "—".
   ===================================================================== */

USE [DRAGONFISH_MITO];
GO

CREATE OR ALTER VIEW ZooLogic.vw_ARTICULOS_MITO
AS
SELECT
    W.ARTCOD                                   AS ID_ARTICULO,
    ISNULL(NULLIF(LTRIM(RTRIM(W.COLOR)), ''), LTRIM(RTRIM(W.COLOR_CODIGO)))  AS COLOR,
    ISNULL(NULLIF(LTRIM(RTRIM(W.TALLE_DESCRIPCION)), ''), LTRIM(RTRIM(W.TALLE))) AS TALLE,

    -- "nombre completo": modelo + descripción adicional
    CONCAT(
        NULLIF(LTRIM(RTRIM(W.ARTDES)), ''),
        CASE WHEN NULLIF(LTRIM(RTRIM(W.ARTDESADIC)), '') IS NOT NULL
             THEN CONCAT(' - ', LTRIM(RTRIM(W.ARTDESADIC))) ELSE '' END
    )                                           AS NOMBRE_COMPLETO,

    -- >>> acá va la columna de material de tu base (ver nota arriba) <<<
    NULLIF(LTRIM(RTRIM(W.MATERIAL)), '')         AS MATERIAL,

    NULLIF(LTRIM(RTRIM(W.GRUPO)), '')            AS GRUPO,

    -- físico + en tránsito - pedido - preparado (Stock disponible de MITO)
    CAST(ISNULL(W.STOCK_DISPONIBLE, 0) AS INT)   AS STOCK_MITO,

    CAST(W.PRECIO AS DECIMAL(18,2))              AS PRECIO
FROM ZooLogic.vw_PRODUCTOS_WEB W
WHERE NULLIF(LTRIM(RTRIM(W.ARTCOD)), '') IS NOT NULL
;
GO

/* ---------------------------------------------------------------------
   COMPROBACIÓN (en el SQL Server)

      SELECT TOP 20 * FROM ZooLogic.vw_ARTICULOS_MITO;
      SELECT TOP 20 * FROM ZooLogic.vw_ARTICULOS_MITO
      WHERE ID_ARTICULO LIKE '%BG01%' OR NOMBRE_COMPLETO LIKE '%reloj%';

   Si la segunda consulta tarda más de 1 o 2 segundos, fijá los índices:

      CREATE INDEX IX_COMB_COART     ON ZooLogic.COMB     (COART)     INCLUDE (COCOL, TALLE, COCANT, ENTRANSITO, PEDIDO, PREPARADO);
      CREATE INDEX IX_PRECIOAR_BUSCA ON ZooLogic.PRECIOAR (LISTAPRE, ARTICULO, CCOLOR) INCLUDE (PDIRECTO, FECHAVIG, HMODIFW);

   ---------------------------------------------------------------------
   PERMISOS del usuario del puente (en esta base)

      CREATE USER scan_stock FOR LOGIN scan_stock;
      GRANT SELECT ON ZooLogic.vw_ARTICULOS_MITO TO scan_stock;
      GRANT VIEW DEFINITION ON ZooLogic.vw_ARTICULOS_MITO TO scan_stock;

   ---------------------------------------------------------------------
   DESPUÉS, EN EL HUB (sin redeploy)

   1. Configuraciones → Conexión SQL → agregar a la lista de vistas:
          ZooLogic.vw_ARTICULOS_MITO
      (o la base.esquema.vista completa, según cómo esté configurado el puente)
   2. Habilitar la app en el área Mayorista desde Usuarios → Roles
      (permiso 'mayorista.articulos.view').
   ===================================================================== */
