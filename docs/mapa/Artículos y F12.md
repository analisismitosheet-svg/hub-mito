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

## Consulta de precios y stock para clientes (`/precios`, público)
- **LINK FIJO, NO CAMBIAR**: `https://hub-mito.vercel.app/precios` va en un QR impreso en las remeras de los empleados (QR en `docs/qr/consulta-stock-precios.png/.svg`, corrección de errores H). No renombrar el proyecto `hub-mito` de Vercel ni la ruta `/precios`; si hace falta moverla, dejar `/precios` redirigiendo.
- Versión web del tótem `ConsultaPrecios.exe` (`D:\pbi a html\pwa-locales`). Link público sin usuario: https://hub-mito.vercel.app/precios (`?q=CODIGO` abre un artículo; `?local=CFRA` fija el local, para un QR por local).
- `src/pages/PreciosPublicos.tsx`: buscar por código, nombre (todas las palabras) o escanear (`ScannerCamara`); detalle con fotos (`fotosArticulos.ts`), precio y **stock del local por color × talle** (resalta el color/talle de la etiqueta escaneada) + "también hay en" otros locales, por distancia.
- **Local**: al abrir pide la ubicación (aviso grande para activarla; si la bloqueó, explica cómo). Elige el local más cercano; dentro de 250 m + precisión dice "Estás en este local" y ofrece los vecinos pegados (CFRA/Rivera, CFD/Bustos, CFR9/Ruta 9…). El QR (`?local=`) y la elección a mano (queda en `localStorage`) mandan. La ubicación no sale del celular.
- Locales: 17 al público, **sin MITO, INDO, fábrica, Polo 52, franquicias ni Central**. Nombres y coordenadas en vivo del mapa del tracking (`tracking_bases`) por la RPC `precios_publicos_locales` (`src/lib/localesPublicos.ts`, con lista de respaldo sin coordenadas).
- Precio: RPC `precios_publicos_buscar(p_q)` (`sql/precios_publicos.sql`, `SECURITY DEFINER`, ejecuta `anon`): resuelve etiqueta (`ART!COLOR!TALLE`, `ART%CCTALLE`, `N+cod`), código, código de barras (`equivalencias`) o texto (máx. 40). `articulos.precio_publico` = LISTA1 (Contado) de `DRAGONFISH_INDOD` vía `DWH.vw_DIM_ARTICULO`, copiado 07:15 (un cambio de precio aparece al día siguiente). La tabla `articulos` sigue cerrada para `anon`.
- **General Paz (GPAZD) = precios Outlet**: lista `OUTLET` («OUTLET - GPAZ») de `DRAGONFISH_GRALPAZ`, en vivo (vigente hoy). Sin precio outlet → Contado. Se ve "Outlet" en la lista y "Precio Outlet · General Paz Outlet" en el detalle.
- Stock y outlet: `GET /api/sql/stock-publico?articulo=` y `?local=GPAZD&articulos=A,B` (`src/lib/stockPublicoApi.ts`, **sin sesión**): solo GET, códigos `^[A-Z0-9]{2,20}$`, solo artículos con precio público, tope 40 pedidos/min por IP, cache CDN 60 s, respuesta refiltrada (solo locales conocidos, color, talle, unidades). Puente: acciones `stock_publico` (COMB de cada base, réplicas de esta PC o principal según la base; 60 s de cache) y `precios_local_publico` (5 min). Listas fijas `STOCK_PUBLICO_LOCALES` / `LISTAS_LOCAL_PUBLICO` en `puente-sql/server.js`: el pedido no elige bases.
- **Marca según el local** (`src/pages/precios.css`, variables `--pp-*`): locales `CF*` con el tema Captain Fin del tótem (blanco/negro, Bebas Neue + Nunito, logo `public/marcas/captain-fin.png`); el resto Indonesia (negro/rojo, `public/marcas/indonesia.png`). Precio como el tótem: con IVA grande, sin IVA y el IVA 21 % al lado, y grupo · material · temporada (el puente lo agrega en `stock_publico.detalle`).
- **Fotos**: tabla `articulos_fotos` (`sql/articulos_fotos.sql`, sin acceso directo) por origen: `indonesiashop` (API de Tiendanube; código entre paréntesis en el nombre o al final de la URL; `puente-sql/scripts/sync-fotos-tiendanube.js`, tarea «MITO - Sync fotos Tiendanube» 07:40) y `ventasxmayor` (el `public/fotos-articulos.json`, subido con `--json=`). La búsqueda devuelve `fotos` (indonesiashop primero, hasta 14) vía `private.fotos_articulo`; la página ya no baja el JSON. Sin foto: recuadro «Sin foto». Carga del 16/11: 6055 + 1854 artículos (6550 distintos).
- **En el hub**: área **Locales → «Consulta stock entre locales»** (`consulta-stock-locales` en `src/config/areas.ts`, sin permiso: la ve todo el que entra a Locales) abre la misma `/precios`; con sesión iniciada aparece «← Hub» en la cabecera (vuelve a `/area/locales`).
- **Usuarios del hub (con sesión)**: no se pide ubicación (eligen el local de la lista, queda recordado), botones **«QR para imprimir (PDF)»** y **PNG** del link fijo (`src/lib/qrPdf.ts`, QR 2000 px corrección H con `qrcode.react`) y tabla **«Stock en todos los locales»** (local × color por talle). Los clientes no ven nada de eso.
- **Escaneo como el F12**: el buscador queda siempre a la vista (también en el detalle, «Escaneá otra etiqueta…»); lo leído cae ahí y, con el buscador en foco (lector USB/Bluetooth), queda seleccionado para que la próxima etiqueta lo reemplace. La cámara lee QR, EAN-13/8, UPC, Code 39 y Code 128; un QR con link `…?q=CODIGO` usa el código.
- **Modo hub** solo entrando desde Locales (la app abre `/precios?desde=hub`, queda en `sessionStorage`) y con sesión: un cliente con sesión del hub abierta en el celular no lo ve. Pestaña y acceso directo con el ícono y nombre de la marca (`public/marcas/icono-*.png`), no la «M» del hub.
- **Grilla del local** sin total y con columnas divididas; tocar una celda (o el talle de arriba) muestra abajo ese color/talle en los otros locales.
- **Service worker**: `/precios` está en `navigateFallbackDenylist` (`vite.config.ts`): siempre se carga del servidor. Con una copia vieja del hub (sin la ruta) el catch-all mandaba al login.
- **Sin local elegido** la grilla suma todos los locales («Stock en todos los locales por color y talle») y abajo «Hay en estos locales». **En el hub** arranca con el local del usuario (`perfil.local`, «Tu local»); el admin y quien no tiene local arrancan en «Todos los locales» (opción que en el hub siempre está en la lista). Lo elegido en el hub no se guarda en `localStorage`.
- Si se suma un local: agregarlo en `STOCK_PUBLICO_LOCALES` (puente), `LOCALES` de `stockPublicoApi.ts`, el `VALUES` de `precios_publicos_locales` y `RESPALDO` de `localesPublicos.ts`.
