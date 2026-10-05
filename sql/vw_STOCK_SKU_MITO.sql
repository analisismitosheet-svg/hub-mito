/* =====================================================================
   PEDIDOS DE VENTA - stock por SKU (articulo + color + talle)

   Pedidos de venta muestra una columna de stock al lado de la cantidad de
   cada linea. La linea es un SKU, no solo el articulo: lo que importa es
   si hay de ESE color y ESE talle, asi que hace falta el stock por
   combinacion.

   Vive sobre vw_ARTICULOS_MITO (la misma que lee F12 Consulta articulos):
   el numero es identico al de ahi y la formula de stock (COCANT -
   PEDIDO - PREPARADO, piso 0, solo sucursal MITO) esta definida en un
   solo lugar.

   Por que no se lee vw_ARTICULOS_MITO directamente: trae 14 columnas y
   6,8 MB de JSON, que no entra en una respuesta de funcion serverless.
   Estas 4 columnas pesan 1,45 MB y con eso alcanza.

   Peso: 17 691 filas x 4 columnas (una por SKU; la vista origen trae
   2 409 articulos).

   Verificacion (2026-10-05): de 192 308 lineas de pedido de venta del
   2026, 192 299 (99,995%) encuentran su SKU exacto en esta vista.

   -------------------------------------------------------------------------
   Correr:  node scripts/sql.mjs --alias -f sql/vw_STOCK_SKU_MITO.sql
            (--alias = la instancia local; sin --alias cae en ZOOLOGIC, que
             NO tiene estas vistas)
   Verificar:
            node scripts/sql.mjs --alias "SELECT COUNT(*) filas FROM VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SKU_MITO"
   Habilitar en el hub: Configuraciones > Conexión SQL. Queda fija por env
   (SQL_VIEWS en Vercel), asi que ya viene habilitada.
   ===================================================================== */

USE [VISTAS_CONSOLIDADAS];
GO

CREATE OR ALTER VIEW dbo.vw_STOCK_SKU_MITO
AS
SELECT
    ID_ARTICULO,
    COLOR_CODIGO,
    TALLE_CODIGO,
    CAST(SUM(STOCK_MITO) AS INT) AS STOCK_MITO
FROM dbo.vw_ARTICULOS_MITO
WHERE NULLIF(LTRIM(RTRIM(ID_ARTICULO)), '') IS NOT NULL
GROUP BY ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO;
GO
