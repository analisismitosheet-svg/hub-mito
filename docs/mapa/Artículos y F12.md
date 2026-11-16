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

## Consulta de precios para clientes (`/precios`, público)
- Versión web del tótem `ConsultaPrecios.exe` (`D:\pbi a html\pwa-locales`, que lee LISTA1 en vivo del SQL del local). Link público sin usuario: https://hub-mito.vercel.app/precios (con `?q=CODIGO` abre directo un artículo).
- `src/pages/PreciosPublicos.tsx`: buscar por código, nombre (todas las palabras) o escanear (`ScannerCamara`); detalle con fotos de `fotosArticulos.ts`. **Solo precio**: nada de stock.
- RPC `precios_publicos_buscar(p_q)` (`sql/precios_publicos.sql`, `SECURITY DEFINER`, ejecuta `anon`): resuelve etiqueta (`ART!COLOR!TALLE`, `ART%CCTALLE`, `N+cod`), código de artículo, código de barras (`equivalencias`) o texto (máx. 40). La tabla `articulos` sigue cerrada para `anon`.
- Precio = `articulos.precio_publico` = LISTA1 de `DRAGONFISH_INDOD` (vía `DWH.vw_DIM_ARTICULO`), copiado por el sync de artículos a las 07:15: un cambio de precio aparece al día siguiente.
