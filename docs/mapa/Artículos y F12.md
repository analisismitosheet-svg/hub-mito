# Artículos y F12

## Maestro `public.articulos`
- Viene de `DWH.dbo.vw_DIM_ARTICULO` por `sync-articulos.js` ([[Puente SQL y syncs]]), ~92.800 artículos.
- `articulo` = `ID_ART` trim + mayúsculas. **Se excluyen los ID con espacio en el medio** (`WHERE CHARINDEX(' ', RTRIM(ID_ART)) = 0`).
- `descripcion` = **`ARTICULO_ADICIONAL`** y si viene vacío `ARTICULO`. En toda la PWA la descripción de un artículo sale de acá.
- Helpers: `src/lib/descripcionArticulos.ts` → `descripcionesMaestro(codigos)` (tandas de 200), usado en PedidosVenta, PedidosCompra, Picking. `src/lib/articulosConsulta.ts` prioriza `m.descripcion`.

## F12 Consulta artículos (`/mayorista/consulta-articulos`)
- `ConsultaArticulos.tsx` → `articulosConsulta.ts` → `sqlApi.ts` (`leerVistaFiltrada`) → `/api/sql/<vista>` → puente → `VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO`.
- Solo busca lo escrito (no carga todo al entrar). Una columna color y otra talle; color como `02 NEGRO`; fondo alterno al cambiar de color; tilde "sin stock"; talles ordenados por tamaño.
- Permiso `mayorista.articulos.view`.

## Stock
- Stock = `COCANT - PEDIDO - PREPARADO`, piso 0, solo sucursal MITO. **No usar `vw_PRODUCTOS_WEB`.** Precio = lista `LISTA2` (MAYOR).
- `vw_STOCK_SKU_MITO` (por SKU, `src/lib/stockSku.ts`, columna Stock de pedidos de venta) y `vw_STOCK_ARTICULO_MITO` (por artículo, `src/lib/stockArticulos.ts`, [[Mapeo depósito]]).
- Orden de talles: `compararTalle` (por tamaño, no alfabético).
