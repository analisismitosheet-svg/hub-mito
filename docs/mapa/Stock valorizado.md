# Stock valorizado

Área **Administradores** → `/administradores/stock-valorizado` (`StockValorizado.tsx`, permiso `stock_valorizado.view`).
Cuántas unidades hay y cuánta plata es, **a costo**, sucursal por sucursal.

## De dónde salen los números
- **Stock**: `ZooLogic.COMB` (una fila por SKU: `COART`, `COCOL`, `TALLE`, `COCANT`) de **cada base `DRAGONFISH_*`** del SQL Server principal (M1T0O1\ZOOLOGIC). Se recorren todas las que el usuario del puente puede leer; solo cuenta `COCANT > 0`.
- **Costo**: lista de precios **«Compra» = `LISTA0`** de `DRAGONFISH_MITO.ZooLogic.PRECIOAR`, tomando la `FECHAVIG` más nueva de cada artículo. En Dragon el costo está cargado **por artículo** (`CCOLOR`/`TALLE` vienen vacíos salvo un puñado), así que se valoriza por artículo, no por SKU.
- Las unidades de artículos **sin costo** cargado se cuentan en "Unidades" pero suman $0 (la pantalla las muestra aparte, en ámbar).
- Nombres de sucursal: la tabla `NOMBRES` de `src/lib/replicas.ts` (`DRAGONFISH_VCPD` → CARLOS PAZ).

## Camino
`StockValorizado.tsx` → `src/lib/stockValorizado.ts` → `GET /api/sql/stock-valorizado[?forzar=1]` → `src/lib/stockValorizadoApi.ts` (cuelga del router `api/sql/[ruta].ts`, igual que `status` y `catalogo`, por el tope de 12 funciones de Vercel) → Puente SQL `{ accion: 'stock_valorizado' }` → `puente-sql/sql/stock-valorizado.sql`.

- La consulta recorre ~40 bases y tarda **~12 s**: el puente la **cachea 10 minutos** y comparte la corrida si llegan dos pedidos juntos. El botón **Actualizar** manda `forzar` y recalcula de cero.
- Es solo lectura: nada de DDL ni escrituras (las temporales `#costo`/`#bases`/`#art` son de la sesión).
- Devuelve tres cosas: fila por base, top 200 artículos por valorizado (todas las bases juntas) y el contexto del costo (artículos con costo).

## Detalles de la pantalla
- Tarjetas: valorizado total, unidades + SKUs, sucursales, unidades sin costo (con su %).
- Tabla por sucursal con costo promedio, % del total y barra; total al pie. Excel con dos hojas (Por sucursal / Top artículos).
- **Bases sin costo cargado**: las que valorizan $0 quedan afuera del total de entrada (hoy `DRAGONFISH_NOMED`, ~1,67 M de unidades de insumos) y se suman con el botón ámbar, para que el total no engañe.
- Dev: `node scripts/mock-stock-valorizado.mjs` (vite proxyea `/api/sql/stock-valorizado` a `:4175`) con el Puente SQL corriendo.

> Al tocar `puente-sql/server.js` hay que **reiniciar el puente** de la PC central: la tarea "MITO - Puente SQL" lo relevanta sola cuando el puerto 3128 queda libre (chequea cada 60 s).

Relacionado: [[Puente SQL y syncs]] · [[Artículos y F12]] · [[Permisos y usuarios]]
